/**
 * Onde cada documento fiscal mora no bucket `fiscal-xml`.
 *
 * O bucket é COMPARTILHADO com o EasyML (NF-e mod. 55 e CT-e, ~102 mil objetos). Estes
 * caminhos são os mesmos que ele usa, com `model = 65` — foi assim que a migração do bucket
 * previu a chegada da NFC-e ("D7 do EasyFood, decidida e nao executada"). Manter o formato
 * idêntico é o que permite ao contador achar NF-e e NFC-e da mesma loja lado a lado.
 *
 * ── QUEM MONTA O CAMINHO É A API, NUNCA O CLIENTE ─────────────────────────────
 * O worker manda os DADOS (empresa, loja, chave, data) e a API deriva o caminho. Aceitar
 * um `path` pronto seria deixar quem chama escrever em qualquer lugar do bucket — inclusive
 * por cima do acervo de outra empresa.
 */

/**
 * A data de emissão não tem forma de ISO. É erro de DOMÍNIO (este arquivo não conhece HTTP):
 * quem o traduz para 400, com a mesma mensagem, é o `StorageService`.
 */
export class DataDeEmissaoInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataDeEmissaoInvalidaError';
  }
}

/** Os três formatos. `kind` do documento é o nome do arquivo, não da pasta. */
export type FiscalXmlKindNota = 'authorized' | 'signed' | 'cancellation';
export type FiscalXmlKindEvento = 'request' | 'response';

/**
 * O que identifica a PASTA de uma nota.
 *
 * A chave de acesso é o nome natural (é ela que a SEFAZ usa), mas nota rejeitada ou rascunho
 * muitas vezes não tem chave — daí o fallback. `number`/`serie`/`noteId` só são consultados
 * nesse caso.
 */
export interface IdentidadeDaNota {
  accessKey?: string | null;
  number?: number | string | null;
  serie?: number | string | null;
  noteId?: string | null;
}

/**
 * Nome da pasta da nota: a chave de acesso, ou um substituto estável quando não há chave.
 *
 * ⚠️ **Esta é a MESMA regra que o ZIP usa para nomear o arquivo** (`nomeBase`, em
 * `nfce/domain/nfce-xml-archive-entries.ts`, que importa daqui). Duas implementações da mesma regra é como
 * o mesmo documento acaba em dois caminhos diferentes — um no bucket, outro no pacote do
 * contador — sem que nada acuse.
 *
 * O teste de `>= 20` dígitos (e não `=== 44`) vem de lá e fica de propósito: é frouxo por
 * segurança, para que uma chave truncada por bug de origem continue caindo na árvore de
 * chave em vez de inventar uma pasta `sem-chave-*` nova a cada correção.
 */
export function nomeBaseDaNota(id: IdentidadeDaNota): string {
  const chave = String(id.accessKey ?? '').replace(/\D/g, '');
  if (chave.length >= 20) return chave;
  const numero = String(id.number ?? '0').replace(/\D/g, '').padStart(9, '0');
  const serie = String(id.serie ?? '0').replace(/\D/g, '').padStart(3, '0');
  const sufixo = String(id.noteId ?? '').replace(/[^0-9a-f]/gi, '').slice(0, 8) || 'semid';
  return `sem-chave-${numero}-${serie}-${sufixo}`;
}

/**
 * Ano e mês da emissão, **cortados da string**.
 *
 * ⚠️ É intencional, e é o inverso do conselho habitual sobre `slice` em data. `dhEmi` vem com
 * o offset embutido (`2026-12-31T23:30:00-03:00`), então os 10 primeiros caracteres JÁ SÃO a
 * data local do emitente. Converter para `Date` e ler `getUTCFullYear()` devolveria **2027**
 * para essa nota — arquivo no ano fiscal errado, e o contador não acha o documento no mês em
 * que ele foi emitido.
 *
 * Por isso a função aceita `string` e recusa qualquer outra coisa: um `Date` que chegasse aqui
 * já teria perdido o fuso do emitente.
 */
function anoEMesDaEmissao(issuedAt: string): { ano: string; mes: string } {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(String(issuedAt));
  if (!m) {
    throw new DataDeEmissaoInvalidaError(
      `Data de emissão inválida para o caminho do XML: "${issuedAt}". ` +
        'Esperado ISO local do emitente (YYYY-MM-DD...), com o offset preservado.',
    );
  }
  return { ano: m[1], mes: m[2] };
}

/** Prefixo de tenant. Sem ele não há isolamento por empresa dentro do bucket. */
function raiz(companyId: string, storeId: string, model: string): string {
  return `${companyId}/${storeId}/${model}`;
}

/**
 * XML da nota:
 *   `{company}/{store}/{model}/{YYYY}/{MM}/{chave44}/{kind}.xml`
 */
export function caminhoDoXmlDaNota(p: {
  companyId: string;
  storeId: string;
  model: string;
  /** `issued_at` como STRING ISO — ver `anoEMesDaEmissao`. */
  issuedAt: string;
  nota: IdentidadeDaNota;
  kind: FiscalXmlKindNota;
}): string {
  const { ano, mes } = anoEMesDaEmissao(p.issuedAt);
  return `${raiz(p.companyId, p.storeId, p.model)}/${ano}/${mes}/${nomeBaseDaNota(p.nota)}/${p.kind}.xml`;
}

/**
 * XML de evento (cancelamento, carta de correção):
 *   `{…}/{YYYY}/{MM}/{chave44}/event-{tipo}-{seq}.xml`  (ou `-resposta.xml`)
 *
 * O evento pendura na pasta DA NOTA, e não numa árvore própria: é o que faz o contador
 * encontrar nota e evento no mesmo lugar. O `YYYY`/`MM` sai de `note_issued_at` (a tabela de
 * eventos replica essa coluna justamente para não depender de join), não da data do evento —
 * um cancelamento em janeiro pertence ao mês fiscal da NOTA, não ao do cancelamento.
 */
export function caminhoDoXmlDoEvento(p: {
  companyId: string;
  storeId: string;
  model: string;
  /** `note_issued_at` como STRING ISO. */
  noteIssuedAt: string;
  nota: IdentidadeDaNota;
  eventType: string;
  eventSequence: number;
  kind: FiscalXmlKindEvento;
}): string {
  const { ano, mes } = anoEMesDaEmissao(p.noteIssuedAt);
  const tipo = String(p.eventType).replace(/[^0-9A-Za-z]/g, '') || 'evento';
  const seq = String(p.eventSequence).replace(/\D/g, '').padStart(3, '0');
  const sufixo = p.kind === 'response' ? '-resposta' : '';
  return (
    `${raiz(p.companyId, p.storeId, p.model)}/${ano}/${mes}/${nomeBaseDaNota(p.nota)}` +
    `/event-${tipo}-${seq}${sufixo}.xml`
  );
}

/**
 * XML de inutilização de faixa:
 *   `{company}/{store}/{model}/{YYYY}/inutilizations/{serie}-{inicio}-{fim}.xml`
 *
 * Fica FORA da árvore de chave porque inutilização não tem chave de acesso — é a regra que o
 * EasyML já documentou na migração do bucket. Só o ANO (a faixa é anual, `year` é coluna da
 * tabela; não há mês).
 *
 * ⚠️ O comentário do EasyML escreve este caminho SEM `{company}/{store}`. Tratamos como
 * omissão do comentário, não como desenho: sem o prefixo de tenant, a inutilização de uma
 * empresa cairia na raiz do bucket compartilhado.
 */
export function caminhoDoXmlDaInutilizacao(p: {
  companyId: string;
  storeId: string;
  model: string;
  year: number;
  serie: number;
  numberStart: number;
  numberEnd: number;
}): string {
  const ano = String(p.year).replace(/\D/g, '').padStart(4, '0');
  const serie = String(p.serie).replace(/\D/g, '').padStart(3, '0');
  const ini = String(p.numberStart).replace(/\D/g, '').padStart(9, '0');
  const fim = String(p.numberEnd).replace(/\D/g, '').padStart(9, '0');
  return `${raiz(p.companyId, p.storeId, p.model)}/${ano}/inutilizations/${serie}-${ini}-${fim}.xml`;
}
