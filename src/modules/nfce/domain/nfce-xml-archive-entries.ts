import { nomeBaseDaNota } from '../../storage/domain/fiscal-xml-path';

export interface NfceXmlArchiveRow {
  id: string;
  number: number | string | null;
  serie: number | string | null;
  access_key: string | null;
  status: string | null;
  issued_at: Date | string | null;
  /** ⟨Fase 5⟩ Esvaziadas em 16/09/2026. Permanecem no tipo só até saírem da view. */
  authorized_xml?: string | null;
  cancellation_xml?: string | null;
  signed_xml?: string | null;
  /** ⟨D-1⟩ Não migra: é INI do ACBr, não XML. Só existe em coluna. */
  generated_xml: string | null;
  /** Referências ao bucket (D7). Preferidas quando existem — ver `fonteDoXml`. */
  storage_authorized_xml_bucket?: string | null;
  storage_authorized_xml_path?: string | null;
  storage_authorized_xml_bytes?: number | null;
  storage_cancellation_xml_bucket?: string | null;
  storage_cancellation_xml_path?: string | null;
  storage_cancellation_xml_bytes?: number | null;
  storage_signed_xml_bucket?: string | null;
  storage_signed_xml_path?: string | null;
  storage_signed_xml_bytes?: number | null;
}

/**
 * De onde sai o conteúdo de UMA entrada do ZIP.
 *
 * O ZIP deixou de carregar o XML junto com a linha: agora a linha traz ou o texto (legado,
 * durante a convivência) ou o ENDEREÇO no bucket. Quem resolve o endereço é o `carregarXml`
 * injetado em `montarArquivoZipDeXml` — manter o download fora daqui é o que preserva este
 * módulo testável sem rede, que é como os 22 testes existentes funcionam.
 */
export type FonteDoXml =
  | { tipo: 'texto'; xml: string }
  | { tipo: 'storage'; bucket: string; path: string; bytes: number | null };

/** Tamanho conhecido ANTES de baixar. É o que permite recusar um pacote grande demais. */
export function pesoDaFonte(f: FonteDoXml): number {
  return f.tipo === 'texto' ? Buffer.byteLength(f.xml, 'utf8') : (f.bytes ?? 0);
}

/**
 * Escolhe a fonte de um dos XML da nota.
 *
 * ⟨Fase 5 — o corte, 16/09/2026⟩ **O fallback para a coluna `text` acabou.** Durante a
 * convivência (Fases 2 a 4) os dois lugares estavam preenchidos e a coluna servia de rede;
 * agora ela está vazia por decisão, e insistir em lê-la só mascararia uma referência que
 * faltou — devolvendo "nota sem XML" onde o certo é falhar e alguém investigar.
 *
 * `generated` não passa por aqui: é INI do ACBr, nunca foi ao bucket, e continua em coluna
 * ⟨D-1⟩ — é a única fonte de texto que resta.
 */
function fonteDoXml(
  bucket: string | null | undefined,
  path: string | null | undefined,
  bytes: number | null | undefined,
): FonteDoXml | null {
  if (path && bucket) return { tipo: 'storage', bucket, path, bytes: bytes ?? null };
  return null;
}

/** Nome da pasta dentro do ZIP, por situação da nota. */
export const PASTA_AUTORIZADAS = 'autorizadas';
export const PASTA_CANCELADAS = 'canceladas';
export const PASTA_OUTRAS = 'nao-autorizadas';

export interface EntradaXml {
  nome: string;
  fonte: FonteDoXml;
}

/**
 * Qual XML sai para cada nota, e com que nome.
 *
 * A regra segue a mesma da tela de detalhe (`NfceDetailPage`): autorizada e cancelada
 * levam o `authorized_xml` (o procNFe, único documento que vale para a escrituração);
 * a cancelada leva **também** o XML do evento de cancelamento. Rejeitada/rascunho não
 * têm procNFe — vai o assinado ou o gerado, que servem só para diagnóstico, e por isso
 * ficam numa pasta separada: misturar isso com o que é escriturável é o tipo de coisa
 * que faz o contador importar nota rejeitada.
 */
export function entradasDaNota(row: NfceXmlArchiveRow): EntradaXml[] {
  const base = nomeBase(row);
  const status = String(row.status ?? '').toLowerCase();

  const autorizado = fonteDoXml(
    row.storage_authorized_xml_bucket,
    row.storage_authorized_xml_path,
    row.storage_authorized_xml_bytes,
  );
  const cancelamento = fonteDoXml(
    row.storage_cancellation_xml_bucket,
    row.storage_cancellation_xml_path,
    row.storage_cancellation_xml_bytes,
  );
  const assinado = fonteDoXml(
    row.storage_signed_xml_bucket,
    row.storage_signed_xml_path,
    row.storage_signed_xml_bytes,
  );
  // ⟨D-1⟩ `generated` nunca tem fonte no bucket: é INI do ACBr, não XML.
  const gerado = row.generated_xml ? ({ tipo: 'texto', xml: row.generated_xml } as const) : null;

  // "Cancelada" passa a considerar TAMBÉM a referência no bucket. Olhar só a coluna faria a
  // nota cancelada cair na pasta `autorizadas/` depois que a coluna for esvaziada na Fase 5.
  const cancelada = status === 'cancelled' || cancelamento !== null;
  const entradas: EntradaXml[] = [];

  if (autorizado) {
    const pasta = cancelada ? PASTA_CANCELADAS : PASTA_AUTORIZADAS;
    entradas.push({ nome: `${pasta}/${base}.xml`, fonte: autorizado });
  }
  if (cancelamento) {
    entradas.push({ nome: `${PASTA_CANCELADAS}/${base}-cancelamento.xml`, fonte: cancelamento });
  }
  if (entradas.length === 0) {
    if (assinado) entradas.push({ nome: `${PASTA_OUTRAS}/${base}-assinada.xml`, fonte: assinado });
    else if (gerado) entradas.push({ nome: `${PASTA_OUTRAS}/${base}-gerada.xml`, fonte: gerado });
  }
  return entradas;
}

/**
 * Identidade do arquivo. A chave de acesso é o nome que o contador espera (é ela que a
 * SEFAZ usa), mas nota rejeitada muitas vezes não tem chave — aí o nome cai para
 * número/série mais um pedaço do id, que garante unicidade sem parecer chave de verdade.
 *
 * A regra vive em `storage/fiscal-xml-path`, e não aqui, porque o **caminho no bucket usa
 * exatamente a mesma**: é o nome da pasta do documento. Enquanto eram duas cópias, nada
 * impedia que uma nota sem chave fosse parar numa pasta `sem-chave-A` no Storage e num
 * arquivo `sem-chave-B` dentro do ZIP — o mesmo documento em dois lugares, sem erro nenhum.
 */
function nomeBase(row: NfceXmlArchiveRow): string {
  return nomeBaseDaNota({
    accessKey: row.access_key,
    number: row.number,
    serie: row.serie,
    noteId: row.id,
  });
}
