import { describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { montarArquivoZipDeXml } from '../src/modules/nfce/domain/nfce-xml-archive';
import {
  entradasDaNota,
  type NfceXmlArchiveRow,
} from '../src/modules/nfce/domain/nfce-xml-archive-entries';

/**
 * ZIP do contador lendo do BUCKET (Fase 3 da migração D7).
 *
 * Antes, o XML vinha na própria linha e o ZIP era uma consulta por lote. Agora a linha traz o
 * ENDEREÇO e o conteúdo é baixado. O que estes testes protegem:
 *
 *   1. quando existe referência, é ela que manda — senão a Fase 3 leria a coluna e só
 *      *pareceria* migrada, e o caminho novo nunca seria exercitado de verdade;
 *   2. a coluna continua servindo de rede enquanto a convivência durar;
 *   3. um pacote grande demais é recusado pelo tamanho JÁ CONHECIDO, antes de baixar;
 *   4. nota migrada sem quem saiba baixar é ERRO, não um arquivo faltando em silêncio —
 *      o contador não tem como perceber um XML ausente dentro de um ZIP de mil.
 */

const AGORA = new Date('2026-08-06T12:00:00.000Z');

function nota(over: Partial<NfceXmlArchiveRow> = {}): NfceXmlArchiveRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    number: 1164,
    serie: 2,
    access_key: '35260413971933000178650020000011641837486150',
    status: 'authorized',
    issued_at: '2026-07-31T18:21:00.000Z',
    authorized_xml: null,
    cancellation_xml: null,
    signed_xml: null,
    generated_xml: null,
    ...over,
  };
}

const NO_BUCKET = {
  storage_authorized_xml_bucket: 'fiscal-xml',
  storage_authorized_xml_path: 'co/loja/65/2026/07/CHAVE/authorized.xml',
  storage_authorized_xml_bytes: 30,
};

async function zipar(
  linhas: NfceXmlArchiveRow[],
  extra: Partial<Parameters<typeof montarArquivoZipDeXml>[0]> = {},
) {
  const pedacos: Uint8Array[] = [];
  let entregue = false;
  const stats = await montarArquivoZipDeXml({
    buscarLote: async () => {
      if (entregue) return [];
      entregue = true;
      return linhas;
    },
    escrever: (c) => {
      pedacos.push(c.slice());
    },
    cabecalhoResumo: ['Periodo: todo'],
    agora: AGORA,
    ...extra,
  });
  const total = pedacos.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of pedacos) {
    buf.set(p, off);
    off += p.length;
  }
  const arquivos = unzipSync(buf);
  return {
    stats,
    nomes: Object.keys(arquivos).filter((n) => n !== '_RESUMO.txt'),
    conteudo: (n: string) => strFromU8(arquivos[n]),
  };
}

describe('entradasDaNota — de onde vem o conteúdo', () => {
  it('com referência no bucket, a fonte é storage', () => {
    const [e] = entradasDaNota(nota(NO_BUCKET));
    expect(e.fonte).toEqual({
      tipo: 'storage',
      bucket: 'fiscal-xml',
      path: NO_BUCKET.storage_authorized_xml_path,
      bytes: 30,
    });
  });

  /**
   * ⟨Fase 5⟩ A rede foi recolhida. Até o corte, texto sem referência virava fonte `texto`;
   * agora a coluna está vazia por decisão, e insistir em lê-la mascararia uma referência que
   * faltou — o certo é a nota aparecer como SEM XML e alguém investigar.
   */
  it('texto sem referência NÃO vira fonte — o fallback acabou no corte', () => {
    expect(entradasDaNota(nota({ authorized_xml: '<nfeProc/>' }))).toHaveLength(0);
  });

  it('generated continua em coluna — é INI do ACBr, nunca foi ao bucket ⟨D-1⟩', () => {
    const [e] = entradasDaNota(nota({ generated_xml: '[infNFe]' }));
    expect(e.fonte).toEqual({ tipo: 'texto', xml: '[infNFe]' });
  });

  /**
   * Durante a convivência as DUAS estão preenchidas. Preferir o bucket é o que faz a Fase 3
   * exercitar o caminho novo de verdade, em vez de continuar lendo a coluna e só parecer
   * migrada — o erro só apareceria na Fase 5, quando a coluna já estivesse vazia.
   */
  it('havendo referência, é ela que manda (texto residual é ignorado)', () => {
    const [e] = entradasDaNota(nota({ authorized_xml: '<velho/>', ...NO_BUCKET }));
    expect(e.fonte.tipo).toBe('storage');
  });

  /**
   * `cancelada` decidia olhando só a coluna. Depois da Fase 5 isso mandaria toda nota
   * cancelada para a pasta `autorizadas/` — e o contador escrituraria nota cancelada.
   */
  it('nota cancelada pela REFERÊNCIA vai para canceladas/, não autorizadas/', () => {
    const nomes = entradasDaNota(
      nota({
        ...NO_BUCKET,
        status: 'cancelled',
        storage_cancellation_xml_bucket: 'fiscal-xml',
        storage_cancellation_xml_path: 'co/loja/65/2026/07/CHAVE/cancellation.xml',
        storage_cancellation_xml_bytes: 10,
      }),
    ).map((e) => e.nome);
    expect(nomes.every((n) => n.startsWith('canceladas/'))).toBe(true);
  });

  it('⟨D-1⟩ generated nunca vem do bucket — é INI do ACBr', () => {
    const [e] = entradasDaNota(nota({ generated_xml: '[infNFe]' }));
    expect(e.fonte).toEqual({ tipo: 'texto', xml: '[infNFe]' });
    expect(e.nome).toContain('-gerada.xml');
  });
});

describe('montarArquivoZipDeXml — baixando do bucket', () => {
  it('baixa e grava o conteúdo vindo do Storage', async () => {
    const baixar = vi.fn().mockResolvedValue('<nfeProc>do bucket</nfeProc>');
    const z = await zipar([nota(NO_BUCKET)], { baixarDoStorage: baixar });

    expect(baixar).toHaveBeenCalledWith({
      bucket: 'fiscal-xml',
      path: NO_BUCKET.storage_authorized_xml_path,
    });
    expect(z.conteudo(z.nomes[0])).toBe('<nfeProc>do bucket</nfeProc>');
    expect(z.stats.arquivos).toBe(1);
  });

  /** `generated` é a única fonte de texto que restou ⟨D-1⟩ — e não gera download. */
  it('generated sai do ZIP sem tocar no acervo', async () => {
    const baixar = vi.fn();
    const z = await zipar([nota({ generated_xml: '[infNFe]' })], { baixarDoStorage: baixar });
    expect(baixar).not.toHaveBeenCalled();
    expect(z.conteudo(z.nomes[0])).toBe('[infNFe]');
    expect(z.nomes[0]).toContain('-gerada.xml');
  });

  it('nota migrada SEM leitor de storage falha alto, em vez de sumir do pacote', async () => {
    await expect(zipar([nota(NO_BUCKET)])).rejects.toThrow(/sem_leitor_de_storage/);
  });

  /**
   * O teto usa `storage_*_bytes`, que já está na linha — por isso a recusa acontece ANTES de
   * baixar o primeiro arquivo, e a mensagem pode dizer o tamanho real.
   */
  it('recusa pacote acima do teto sem baixar nada', async () => {
    const baixar = vi.fn().mockResolvedValue('x');
    const gordas = Array.from({ length: 5 }, (_, i) =>
      nota({
        id: `00000000-0000-4000-8000-00000000000${i + 1}`,
        access_key: `3526041397193300017865002000001164183748615${i}`,
        ...NO_BUCKET,
        storage_authorized_xml_bytes: 1024 * 1024,
      }),
    );
    await expect(zipar(gordas, { baixarDoStorage: baixar, tetoBytes: 2 * 1024 * 1024 })).rejects.toThrow(
      /pacote_grande_demais/,
    );
    expect(baixar).not.toHaveBeenCalled();
  });

  it('baixa em paralelo, mas grava na ordem das entradas', async () => {
    const ordemDeDownload: string[] = [];
    const baixar = vi.fn(async ({ path }: { path: string }) => {
      ordemDeDownload.push(path);
      // a primeira demora mais: se a gravação seguisse a ordem de CHEGADA, inverteria
      await new Promise((r) => setTimeout(r, path.endsWith('a.xml') ? 20 : 1));
      return `<x>${path}</x>`;
    });
    const linhas = ['a', 'b'].map((k, i) =>
      nota({
        id: `00000000-0000-4000-8000-00000000000${i + 1}`,
        access_key: `3526041397193300017865002000001164183748615${i}`,
        storage_authorized_xml_bucket: 'fiscal-xml',
        storage_authorized_xml_path: `co/loja/65/2026/07/K${i}/${k}.xml`,
        storage_authorized_xml_bytes: 10,
      }),
    );
    const z = await zipar(linhas, { baixarDoStorage: baixar });
    expect(ordemDeDownload).toHaveLength(2);
    expect(z.conteudo(z.nomes[0])).toContain('a.xml');
    expect(z.conteudo(z.nomes[1])).toContain('b.xml');
  });
});
