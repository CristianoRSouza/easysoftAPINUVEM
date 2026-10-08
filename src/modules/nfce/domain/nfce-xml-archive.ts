import { Zip, ZipDeflate, strToU8 } from 'fflate';
import {
  PASTA_AUTORIZADAS,
  PASTA_CANCELADAS,
  entradasDaNota,
  pesoDaFonte,
  type EntradaXml,
  type FonteDoXml,
  type NfceXmlArchiveRow,
} from './nfce-xml-archive-entries';

/**
 * ZIP com os XML das NFC-e — o pacote que o contador pede no fim do mês.
 *
 * ── Por que o ZIP é montado em STREAMING, e não em memória ─────────────────────
 * Cada `authorized_xml` é uma coluna `text` com a nota inteira (~4-8 KB). Um mês de uma
 * loja movimentada passa de 30 mil notas; carregar tudo num array para depois zipar
 * derrubaria o processo da API por memória — e derrubaria para TODAS as lojas, não só
 * para quem clicou. Por isso a montagem lê o banco em lotes e vai empurrando cada
 * arquivo para a resposta HTTP: a memória fica presa ao tamanho do lote, não ao do mês.
 *
 * ── Não existe teto de notas, de propósito ─────────────────────────────────────
 * Quem recorta a exportação é o FILTRO da tela (período, status, busca) — e só ele. Um
 * teto de segurança aqui cortaria o pacote sem o usuário pedir, e o contador entregaria
 * a escrituração achando que exportou o período inteiro. Por isso o streaming acima não
 * é conforto: é o que permite exportar um período grande sem limite artificial.
 */

export interface NfceXmlArchiveStats {
  /** Notas percorridas — TODAS as que casaram com o filtro. */
  notas: number;
  /** XML gravados no ZIP, sem contar o `_RESUMO.txt`. */
  arquivos: number;
  autorizadas: number;
  canceladas: number;
  naoAutorizadas: number;
  /** Notas do filtro que não têm XML nenhum (rascunho que nunca chegou a ser assinado). */
  semXml: number;
}

/** Quantas notas sem XML o resumo lista antes de resumir o resto num total. */
const MAX_LINHAS_SEM_XML = 500;

/**
 * Downloads simultâneos ao montar o ZIP.
 *
 * Antes da D7 o XML vinha junto com a linha: UMA consulta por lote trazia tudo. Agora um mês
 * de 1.164 notas vira 1.164 downloads do bucket.
 *
 * ── NÃO AUMENTE ESTE NÚMERO. MEDIDO EM PRODUÇÃO, 16/09/2026 ───────────────────
 * Julho de 2026 (1.167 objetos, 8,4 MB), baixando do próprio datacenter:
 *
 *     simultâneos │ tempo    │ vazão  │ bytes recebidos
 *     ─────────── │ ──────── │ ────── │ ────────────────
 *              5  │ 108,7 s  │ 11/s   │ 8,43 MB
 *             10  │  76,0 s  │ 15/s   │ 8,36 MB   ← pico
 *             25  │  93,5 s  │ 12/s   │ 6,07 MB   ⚠️
 *             50  │ 141,6 s  │  8/s   │ 3,97 MB   ⚠️
 *
 * Mais paralelismo é MAIS LENTO: o gargalo é o Storage, não a montagem.
 *
 * ⚠️ E o perigo não é a lentidão — é a coluna da direita. Acima de 10, o Storage passa a
 * devolver corpos CURTOS COM HTTP 200: o mesmo número de "sucessos" trazendo metade dos
 * bytes. Quem subir este número achando que acelera vai gerar pacotes com XML truncado
 * **sem nenhum erro aparecer** — e um XML truncado dentro de um ZIP de mil só é descoberto
 * numa fiscalização.
 *
 * O botão real, ponta a ponta, levou 68,4 s para o mesmo mês (mais rápido que os 76 s dos
 * downloads isolados, porque a compactação e o envio correm enquanto os próximos baixam).
 */
const DOWNLOADS_SIMULTANEOS = 10;

/**
 * Teto de bytes do pacote inteiro.
 *
 * Conferido pelo tamanho JÁ CONHECIDO (`storage_*_bytes` na linha), portanto **antes** de
 * baixar qualquer arquivo — é o que permite recusar com o número real na mensagem em vez de
 * estourar a memória no meio da montagem.
 */
const TETO_DO_PACOTE_BYTES = 64 * 1024 * 1024;

export interface OpcoesArquivoZip {
  /** Lê o próximo lote de notas, em ordem de `id`. `null` = primeiro lote. */
  buscarLote: (depoisDoId: string | null) => Promise<NfceXmlArchiveRow[]>;
  /** Escreve um pedaço do ZIP. Pode devolver Promise para dar vazão (backpressure). */
  escrever: (chunk: Uint8Array) => void | Promise<void>;
  /** Linhas que descrevem os filtros usados, para o cabeçalho do `_RESUMO.txt`. */
  cabecalhoResumo: string[];
  /** Data de geração — injetada para o teste não depender do relógio. */
  agora: Date;
  /** `true` interrompe a montagem (cliente fechou o download). */
  abortado?: () => boolean;
  /**
   * Resolve o conteúdo de uma entrada. Injetado para que este módulo continue testável SEM
   * rede — é assim que os testes do ZIP rodam. A fonte `texto` nem chega aqui: só o que vem
   * do bucket precisa de quem saiba baixar.
   */
  baixarDoStorage?: (f: { bucket: string; path: string }) => Promise<string>;
  /** Teto de bytes do pacote. Default 64 MiB. */
  tetoBytes?: number;
}

export async function montarArquivoZipDeXml(
  opts: OpcoesArquivoZip,
): Promise<NfceXmlArchiveStats> {
  const stats: NfceXmlArchiveStats = {
    notas: 0,
    arquivos: 0,
    autorizadas: 0,
    canceladas: 0,
    naoAutorizadas: 0,
    semXml: 0,
  };
  const semXml: string[] = [];
  /** Nomes já usados — duas notas com a mesma chave gerariam entradas duplicadas. */
  const usados = new Set<string>();

  const teto = opts.tetoBytes ?? TETO_DO_PACOTE_BYTES;
  let bytesPrevistos = 0;

  /**
   * Texto vem da própria linha; storage precisa de quem saiba baixar.
   *
   * Sem `baixarDoStorage`, uma nota já migrada não teria como entrar no pacote — e sair
   * calado deixaria o contador com um ZIP a menos sem perceber. Por isso é erro, não omissão.
   */
  const resolver = async (f: FonteDoXml): Promise<string> => {
    if (f.tipo === 'texto') return f.xml;
    if (!opts.baixarDoStorage) {
      throw new Error(`sem_leitor_de_storage: a nota está no bucket (${f.path}) e falta baixarDoStorage`);
    }
    return opts.baixarDoStorage({ bucket: f.bucket, path: f.path });
  };

  const fila: Uint8Array[] = [];
  let erroDoZip: Error | null = null;
  const zip = new Zip((err, chunk, _final) => {
    if (err) {
      erroDoZip = err;
      return;
    }
    if (chunk && chunk.length > 0) fila.push(chunk);
  });

  const descarregar = async () => {
    if (erroDoZip) throw erroDoZip;
    while (fila.length > 0) {
      await opts.escrever(fila.shift() as Uint8Array);
    }
  };

  const gravar = async (nome: string, conteudo: string, mtime?: Date) => {
    const arquivo = new ZipDeflate(nomeUnico(usados, nome), { level: 6 });
    // `mtime` é propriedade da instância (não opção do construtor) e precisa estar posta
    // ANTES do `add` — é no `add` que o cabeçalho local do arquivo é escrito.
    if (mtime) arquivo.mtime = mtime;
    zip.add(arquivo);
    arquivo.push(strToU8(conteudo), true);
    await descarregar();
  };

  let depoisDoId: string | null = null;
  for (;;) {
    if (opts.abortado?.()) throw new Error('download_abortado');
    const lote = await opts.buscarLote(depoisDoId);
    if (lote.length === 0) break;

    /**
     * O lote inteiro vira uma lista de entradas ANTES de baixar qualquer coisa. Duas razões:
     * dá para somar o peso e recusar cedo, e dá para baixar em grupos sem perder a ordem —
     * a ordem importa porque o ZIP é escrito em streaming, um arquivo após o outro.
     */
    const pendentes: { entrada: EntradaXml; mtime: Date | undefined }[] = [];
    for (const row of lote) {
      stats.notas += 1;
      const entradas = entradasDaNota(row);
      if (entradas.length === 0) {
        stats.semXml += 1;
        if (semXml.length < MAX_LINHAS_SEM_XML) semXml.push(descreverNota(row));
        continue;
      }
      const mtime = dataValida(row.issued_at);
      for (const entrada of entradas) pendentes.push({ entrada, mtime });
    }

    for (let i = 0; i < pendentes.length; i += DOWNLOADS_SIMULTANEOS) {
      if (opts.abortado?.()) throw new Error('download_abortado');
      const grupo = pendentes.slice(i, i + DOWNLOADS_SIMULTANEOS);

      // Teto conferido pelo tamanho conhecido, ANTES de baixar o grupo.
      for (const p of grupo) bytesPrevistos += pesoDaFonte(p.entrada.fonte);
      if (bytesPrevistos > teto) {
        throw new Error(
          `pacote_grande_demais: a exportação passa de ${Math.round(teto / 1048576)} MB ` +
            `(já somados ${Math.round(bytesPrevistos / 1048576)} MB). Recorte o período na tela.`,
        );
      }

      const conteudos = await Promise.all(grupo.map((p) => resolver(p.entrada.fonte)));

      for (let j = 0; j < grupo.length; j += 1) {
        const { entrada, mtime } = grupo[j];
        await gravar(entrada.nome, conteudos[j], mtime);
        stats.arquivos += 1;
        if (entrada.nome.startsWith(`${PASTA_AUTORIZADAS}/`)) stats.autorizadas += 1;
        else if (entrada.nome.startsWith(`${PASTA_CANCELADAS}/`)) stats.canceladas += 1;
        else stats.naoAutorizadas += 1;
      }
    }

    depoisDoId = String(lote[lote.length - 1].id);
  }

  await gravar('_RESUMO.txt', montarResumo(opts, stats, semXml), opts.agora);
  zip.end();
  await descarregar();
  return stats;
}

/** Segunda nota com a mesma chave não pode sobrescrever a primeira dentro do ZIP. */
function nomeUnico(usados: Set<string>, nome: string): string {
  if (!usados.has(nome)) {
    usados.add(nome);
    return nome;
  }
  const ponto = nome.lastIndexOf('.');
  const raiz = ponto > 0 ? nome.slice(0, ponto) : nome;
  const ext = ponto > 0 ? nome.slice(ponto) : '';
  for (let i = 2; ; i += 1) {
    const tentativa = `${raiz}-${i}${ext}`;
    if (!usados.has(tentativa)) {
      usados.add(tentativa);
      return tentativa;
    }
  }
}

function descreverNota(row: NfceXmlArchiveRow): string {
  const numero = String(row.number ?? '0').padStart(9, '0');
  const serie = String(row.serie ?? '0').padStart(3, '0');
  const emissao = dataValida(row.issued_at);
  const quando = emissao ? emissao.toISOString().slice(0, 10) : 'sem data';
  return `  ${numero}/${serie}  ${quando}  status=${row.status ?? '-'}`;
}

function dataValida(v: Date | string | null): Date | undefined {
  if (v == null) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function montarResumo(
  opts: OpcoesArquivoZip,
  stats: NfceXmlArchiveStats,
  semXml: string[],
): string {
  const linhas: string[] = [
    'EasyFood - Exportacao de XML de NFC-e',
    `Gerado em: ${opts.agora.toISOString()}`,
    '',
    'Filtros aplicados:',
    ...opts.cabecalhoResumo.map((l) => `  ${l}`),
    '',
    `Notas exportadas .......: ${stats.notas}`,
    `Arquivos XML no pacote .: ${stats.arquivos}`,
    `  autorizadas/ .........: ${stats.autorizadas}`,
    `  canceladas/ ..........: ${stats.canceladas}`,
    `  nao-autorizadas/ .....: ${stats.naoAutorizadas}`,
    `Notas sem XML ..........: ${stats.semXml}`,
  ];

  if (semXml.length > 0) {
    linhas.push(
      '',
      'Notas sem nenhum XML (nao chegaram a ser assinadas):',
      ...semXml,
    );
    if (stats.semXml > semXml.length) {
      linhas.push(`  ... e mais ${stats.semXml - semXml.length} nota(s).`);
    }
  }

  linhas.push(
    '',
    'Pastas: autorizadas/ e canceladas/ contem o XML de autorizacao (procNFe), que e o',
    'documento valido para escrituracao. canceladas/ traz tambem o evento de cancelamento.',
    'nao-autorizadas/ contem XML gerado ou assinado de notas que NAO foram autorizadas -',
    'servem para diagnostico e NAO devem ser escriturados.',
    '',
  );
  return linhas.join('\r\n');
}
