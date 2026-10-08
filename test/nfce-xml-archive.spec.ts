import { describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { montarArquivoZipDeXml } from '../src/modules/nfce/domain/nfce-xml-archive';
import {
  descreverFiltros,
  nomeDoArquivoZip,
} from '../src/modules/nfce/domain/nfce-xml-archive-description';
import type { NfceXmlArchiveRow } from '../src/modules/nfce/domain/nfce-xml-archive-entries';
import { NfceService } from '../src/modules/nfce/application/nfce.service';
import { NfceRepository } from '../src/modules/nfce/infrastructure/nfce.repository';
import { NfceXmlRepository } from '../src/modules/nfce/infrastructure/nfce-xml.repository';
import type { DbService } from '../src/db/db.service';

const AGORA = new Date('2026-08-06T12:00:00.000Z');
const STORE = '33333333-3333-4333-8333-333333333333';

/**
 * Acervo falso — o bucket, em memória.
 *
 * ⟨Fase 5⟩ Depois do corte o XML não mora mais na linha. Os testes continuam DIZENDO
 * "esta nota tem este XML" (`authorized_xml: '<a/>'`), e o helper traduz isso para o que o
 * mundo virou: um objeto no acervo mais a referência na linha. Assim as afirmações sobre
 * CONTEÚDO — que é o que os testes realmente protegem — seguem valendo sem reescrita.
 */
const acervo = new Map<string, string>();

function nota(over: Partial<NfceXmlArchiveRow> = {}): NfceXmlArchiveRow {
  const pedido = {
    id: '00000000-0000-4000-8000-000000000001',
    number: 1164,
    serie: 2,
    access_key: '35260413971933000178650020000011641837486150',
    status: 'authorized',
    issued_at: '2026-07-31T18:21:00.000Z',
    authorized_xml: '<nfeProc>autorizada</nfeProc>',
    cancellation_xml: null,
    signed_xml: null,
    generated_xml: null,
    ...over,
  } as NfceXmlArchiveRow;

  const linha: NfceXmlArchiveRow = {
    ...pedido,
    authorized_xml: null,
    cancellation_xml: null,
    signed_xml: null,
  };
  for (const kind of ['authorized', 'signed', 'cancellation'] as const) {
    const texto = pedido[`${kind}_xml`];
    if (!texto) continue;
    const path = `co/loja/65/2026/07/${pedido.id}/${kind}.xml`;
    acervo.set(path, texto);
    (linha as Record<string, unknown>)[`storage_${kind}_xml_bucket`] = 'fiscal-xml';
    (linha as Record<string, unknown>)[`storage_${kind}_xml_path`] = path;
    (linha as Record<string, unknown>)[`storage_${kind}_xml_bytes`] = Buffer.byteLength(texto);
  }
  // `generated_xml` continua em coluna ⟨D-1⟩: é INI do ACBr, nunca foi ao bucket.
  return linha;
}

/** Monta o ZIP em memória e devolve as entradas já descompactadas. */
async function zipar(lotes: NfceXmlArchiveRow[][]) {
  const pedacos: Uint8Array[] = [];
  const stats = await montarArquivoZipDeXml({
    buscarLote: async (depois) => {
      if (depois === null) return lotes[0] ?? [];
      const i = lotes.findIndex((l) => l.length > 0 && String(l[l.length - 1].id) === depois);
      return lotes[i + 1] ?? [];
    },
    escrever: (c) => {
      pedacos.push(c.slice());
    },
    cabecalhoResumo: ['Periodo: 01/07/2026 ate 31/07/2026'],
    agora: AGORA,
    baixarDoStorage: async ({ path }) => acervo.get(path) ?? '',
  });

  const total = pedacos.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const p of pedacos) {
    bytes.set(p, off);
    off += p.length;
  }
  const entradas = unzipSync(bytes);
  return { stats, bytes, entradas, resumo: strFromU8(entradas['_RESUMO.txt']) };
}

describe('ZIP de XML da NFC-e', () => {
  it('gera um ZIP que abre, com o XML íntegro na pasta de autorizadas', async () => {
    const { entradas, stats } = await zipar([[nota()]]);

    const chave = '35260413971933000178650020000011641837486150';
    expect(Object.keys(entradas).sort()).toEqual(['_RESUMO.txt', `autorizadas/${chave}.xml`]);
    // Integridade byte a byte: XML fiscal que volta diferente do que estava no banco não
    // serve para escrituração nenhuma.
    expect(strFromU8(entradas[`autorizadas/${chave}.xml`])).toBe('<nfeProc>autorizada</nfeProc>');
    expect(stats).toMatchObject({ notas: 1, arquivos: 1, autorizadas: 1, semXml: 0 });
  });

  it('assinatura de arquivo ZIP de verdade (PK\\x03\\x04) — não é um blob qualquer', async () => {
    const { bytes } = await zipar([[nota()]]);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('nota cancelada leva o procNFe E o evento de cancelamento, na pasta de canceladas', async () => {
    const chave = '35260413971933000178650020000011641837486150';
    const { entradas, stats } = await zipar([
      [nota({ status: 'cancelled', cancellation_xml: '<procEventoNFe>cancel</procEventoNFe>' })],
    ]);

    expect(Object.keys(entradas).sort()).toEqual([
      '_RESUMO.txt',
      `canceladas/${chave}-cancelamento.xml`,
      `canceladas/${chave}.xml`,
    ]);
    expect(stats.canceladas).toBe(2);
    expect(stats.autorizadas).toBe(0);
  });

  it('rejeitada/rascunho ficam SEPARADAS — o contador não pode escriturar isso', async () => {
    const { entradas } = await zipar([
      [
        nota({
          id: '00000000-0000-4000-8000-000000000002',
          status: 'rejected',
          access_key: null,
          number: 7,
          serie: 2,
          authorized_xml: null,
          signed_xml: '<NFe>assinada</NFe>',
        }),
        nota({
          id: '00000000-0000-4000-8000-000000000003',
          status: 'draft',
          access_key: null,
          number: 8,
          serie: 2,
          authorized_xml: null,
          generated_xml: '<NFe>gerada</NFe>',
        }),
      ],
    ]);

    expect(Object.keys(entradas).sort()).toEqual([
      '_RESUMO.txt',
      'nao-autorizadas/sem-chave-000000007-002-00000000-assinada.xml',
      'nao-autorizadas/sem-chave-000000008-002-00000000-gerada.xml',
    ]);
  });

  it('nota sem XML nenhum não vira arquivo, mas é NOMEADA no resumo', async () => {
    const { entradas, resumo, stats } = await zipar([
      [
        nota({
          status: 'draft',
          number: 42,
          access_key: null,
          authorized_xml: null,
          signed_xml: null,
          generated_xml: null,
        }),
      ],
    ]);

    expect(Object.keys(entradas)).toEqual(['_RESUMO.txt']);
    expect(stats).toMatchObject({ notas: 1, arquivos: 0, semXml: 1 });
    expect(resumo).toContain('Notas sem XML ..........: 1');
    expect(resumo).toContain('000000042/002');
  });

  it('duas notas com a MESMA chave não se sobrescrevem dentro do ZIP', async () => {
    const chave = '35260413971933000178650020000011641837486150';
    const { entradas } = await zipar([
      [
        nota({ id: '00000000-0000-4000-8000-00000000000a', authorized_xml: '<a/>' }),
        nota({ id: '00000000-0000-4000-8000-00000000000b', authorized_xml: '<b/>' }),
      ],
    ]);

    expect(strFromU8(entradas[`autorizadas/${chave}.xml`])).toBe('<a/>');
    expect(strFromU8(entradas[`autorizadas/${chave}-2.xml`])).toBe('<b/>');
  });

  it('varre TODOS os lotes — o download não para na primeira página', async () => {
    const lote = (n: number, id: string) =>
      nota({ id, number: n, access_key: String(n).padStart(44, '0') });
    const { stats } = await zipar([
      [lote(1, '00000000-0000-4000-8000-000000000001'), lote(2, '00000000-0000-4000-8000-000000000002')],
      [lote(3, '00000000-0000-4000-8000-000000000003')],
    ]);
    expect(stats.notas).toBe(3);
    expect(stats.arquivos).toBe(3);
  });

  it('NÃO existe teto de notas — quem recorta é o filtro, e só ele', async () => {
    // 1.500 notas em 6 lotes: acima de qualquer "teto de segurança" que se pensasse em
    // pôr aqui. Todas têm de sair, senão o contador escritura o período pela metade.
    const uid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const lotes = Array.from({ length: 6 }, (_, l) =>
      Array.from({ length: 250 }, (_, k) => {
        const i = l * 250 + k + 1;
        return nota({ id: uid(i), number: i, access_key: String(i).padStart(44, '0') });
      }),
    );

    const { stats, entradas, resumo } = await zipar(lotes);

    expect(stats.notas).toBe(1500);
    expect(stats.arquivos).toBe(1500);
    expect(Object.keys(entradas)).toHaveLength(1501); // 1.500 XML + resumo
    expect(resumo).not.toMatch(/limite|INCOMPLETA/i);
  });

  it('o resumo registra os filtros que geraram o pacote', async () => {
    const { resumo } = await zipar([[nota()]]);
    expect(resumo).toContain('Filtros aplicados:');
    expect(resumo).toContain('Periodo: 01/07/2026 ate 31/07/2026');
  });

  it('aborto do cliente interrompe a montagem em vez de varrer o banco à toa', async () => {
    const buscarLote = vi.fn(async () => [nota()]);
    await expect(
      montarArquivoZipDeXml({
        buscarLote,
        escrever: () => undefined,
        cabecalhoResumo: [],
        agora: AGORA,
        abortado: () => true,
      }),
    ).rejects.toThrow('download_abortado');
    expect(buscarLote).not.toHaveBeenCalled();
  });
});

describe('nome do arquivo e descrição dos filtros', () => {
  it('leva o período no nome — três "nfce.zip" na pasta Downloads seriam indistinguíveis', () => {
    expect(nomeDoArquivoZip({ from: '2026-07-01', to: '2026-07-31' }, AGORA)).toBe(
      'nfce-xml-2026-07-01-a-2026-07-31.zip',
    );
    expect(nomeDoArquivoZip({ from: '2026-07-01' }, AGORA)).toBe('nfce-xml-desde-2026-07-01.zip');
    expect(nomeDoArquivoZip({ to: '2026-07-31' }, AGORA)).toBe('nfce-xml-ate-2026-07-31.zip');
    expect(nomeDoArquivoZip({}, AGORA)).toBe('nfce-xml-completo-2026-08-06.zip');
  });

  it('formata a data sem passar por Date — o fuso viraria o dia', () => {
    expect(descreverFiltros({ from: '2026-07-01', to: '2026-07-31' })[0]).toBe(
      'Periodo: 01/07/2026 ate 31/07/2026',
    );
  });

  it('traduz o status para o rótulo da tela', () => {
    expect(descreverFiltros({ status: 'authorized' })).toContain('Status: Autorizada');
    expect(descreverFiltros({})).toContain('Status: Todos');
    expect(descreverFiltros({ status: 'all' })).toContain('Status: Todos');
  });
});

describe('NfceService.totals — os cards somam o PERÍODO, não a página', () => {
  function fakeDb(rows: any[] = []) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: params ?? [] });
        return { rows };
      }),
    } as unknown as DbService;
    return { db, calls, svc: new NfceService(new NfceRepository(db), new NfceXmlRepository(db)) };
  }

  it('uma varredura só, agrupada por status, sem limit/offset', async () => {
    const { svc, calls } = fakeDb([
      { status: 'authorized', qtd: '1100', valor: '25130.45' },
      { status: 'rejected', qtd: '23', valor: '500.00' },
    ]);
    const out = await svc.totals(STORE, {});

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('group by 1');
    expect(calls[0].sql).toContain('count(*)');
    expect(calls[0].sql).toContain('sum(n.total_value)');
    expect(calls[0].sql).not.toContain('limit');
    expect(calls[0].sql).not.toContain('offset');
    // 1.100 autorizadas — não as 50 que a tela carrega por página.
    expect(out).toEqual({
      total: 1123,
      porStatus: { authorized: 1100, rejected: 23 },
      valorAutorizado: '25130.45',
    });
  });

  it('só AUTORIZADA soma dinheiro — rejeitada tem valor, mas não houve venda', async () => {
    const { svc } = fakeDb([
      { status: 'rejected', qtd: '5', valor: '999.99' },
      { status: 'draft', qtd: '2', valor: '50.00' },
    ]);
    const out = await svc.totals(STORE, {});
    expect(out.valorAutorizado).toBe('0');
    expect(out.total).toBe(7);
  });

  it('valor fiscal viaja como STRING — float aqui é problema com a Receita', async () => {
    const { svc } = fakeDb([{ status: 'authorized', qtd: '1', valor: '0.10' }]);
    const out = await svc.totals(STORE, {});
    expect(out.valorAutorizado).toBe('0.10');
    expect(typeof out.valorAutorizado).toBe('string');
  });

  it('amarra à loja e usa EXATAMENTE os filtros da listagem', async () => {
    const filtros = {
      status: 'authorized',
      reconcileStatus: 'failed',
      from: '2026-07-01',
      to: '2026-07-31',
      search: '1164',
    };
    const { svc, calls } = fakeDb();
    await svc.list(STORE, { ...filtros, page: 1, limit: 50 });
    await svc.totals(STORE, filtros);

    const [lista, totais] = calls;
    expect(totais.sql).toContain('n.store_id = $1::uuid');
    for (const trecho of [
      'n.status = $2',
      'n.reconcile_status = $3',
      'n.issued_at >= $4::date',
      'n.issued_at < ($5::date + 1)',
      'n.access_key ilike $6',
      'n.number = $7::int',
    ]) {
      expect(lista.sql).toContain(trecho);
      expect(totais.sql).toContain(trecho);
    }
    expect(totais.params).toEqual(lista.params.slice(0, 7));
  });

  it('período vazio devolve zeros, não erro', async () => {
    const { svc } = fakeDb([]);
    await expect(svc.totals(STORE, {})).resolves.toEqual({
      total: 0,
      porStatus: {},
      valorAutorizado: '0',
    });
  });
});

describe('NfceService.xmlArchiveBatch — a consulta que alimenta o ZIP', () => {
  function fakeDb(rows: any[] = []) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: params ?? [] });
        return { rows };
      }),
    } as unknown as DbService;
    return { db, calls, svc: new NfceService(new NfceRepository(db), new NfceXmlRepository(db)) };
  }

  it('amarra à loja em $1 — o role da API tem BYPASSRLS', async () => {
    const { svc, calls } = fakeDb();
    await svc.xmlArchiveBatch(STORE, {}, null, 200);
    expect(calls[0].sql).toContain('n.store_id = $1::uuid');
    expect(calls[0].params[0]).toBe(STORE);
  });

  /**
   * ⟨Fase 5⟩ Antes eram "as quatro colunas de XML". Agora a consulta traz as REFERÊNCIAS —
   * o texto foi esvaziado. `generated_xml` é o único que sobrou em coluna ⟨D-1⟩.
   */
  it('traz as referências ao acervo, e só o generated em coluna', async () => {
    const { svc, calls } = fakeDb();
    await svc.xmlArchiveBatch(STORE, {}, null, 200);
    for (const kind of ['authorized', 'cancellation', 'signed']) {
      expect(calls[0].sql).toContain(`n.storage_${kind}_xml_path`);
      expect(calls[0].sql).not.toContain(`n.${kind}_xml,`);
    }
    expect(calls[0].sql).toContain('n.generated_xml');
  });

  it('pagina por CHAVE, não por offset — nota emitida durante o download não desloca páginas', async () => {
    const { svc, calls } = fakeDb();
    await svc.xmlArchiveBatch(STORE, {}, '00000000-0000-4000-8000-000000000009', 200);
    expect(calls[0].sql).toContain('n.id > $2::uuid');
    expect(calls[0].sql).toContain('order by n.id');
    expect(calls[0].sql).not.toContain('offset');
    expect(calls[0].params[1]).toBe('00000000-0000-4000-8000-000000000009');
  });

  it('usa EXATAMENTE os filtros da listagem — divergir faria a tela e o ZIP contarem diferente', async () => {
    const filtros = {
      status: 'authorized',
      reconcileStatus: 'failed',
      from: '2026-07-01',
      to: '2026-07-31',
      search: '1164',
    };
    const { svc, calls } = fakeDb();
    await svc.list(STORE, { ...filtros, page: 1, limit: 50 });
    await svc.xmlArchiveBatch(STORE, filtros, null, 200);

    const [lista, zip] = calls;
    for (const trecho of [
      'n.status = $2',
      'n.reconcile_status = $3',
      'n.issued_at >= $4::date',
      'n.issued_at < ($5::date + 1)',
      'n.access_key ilike $6',
      'n.number = $7::int',
    ]) {
      expect(lista.sql).toContain(trecho);
      expect(zip.sql).toContain(trecho);
    }
    // Os mesmos valores, na mesma ordem (o limite/offset vem depois).
    expect(zip.params.slice(0, 7)).toEqual(lista.params.slice(0, 7));
  });
});
