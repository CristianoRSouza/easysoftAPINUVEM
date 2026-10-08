/** Os XML que a aba de detalhe sabe pedir. `generated` é INI do ACBr — só diagnóstico ⟨D-1⟩. */
export const NFCE_XML_KINDS = ['authorized', 'cancellation', 'signed', 'generated'] as const;

export type NfceXmlKind = (typeof NFCE_XML_KINDS)[number];

export const isNfceXmlKind = (kind: string): kind is NfceXmlKind =>
  (NFCE_XML_KINDS as readonly string[]).includes(kind);

/** Teto do XML servido inline pela aba de detalhe. NFC-e tem alguns kB; acima disso, ZIP. */
export const XML_INLINE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Onde está o XML de uma nota: a identidade dela, o texto em coluna e a referência no bucket.
 * `bucket`/`path`/`bytes` vêm sempre nulos para `generated` (nunca foi ao bucket).
 */
export interface NfceXmlRefRow {
  number: number | string | null;
  serie: number | string | null;
  access_key: string | null;
  texto: string | null;
  bucket: string | null;
  path: string | null;
  bytes: number | string | null;
}

/** O XML passa do que a aba de detalhe serve inline? Tamanho desconhecido conta como zero. */
export const excedeTetoInline = (bytes: NfceXmlRefRow['bytes']): boolean =>
  Number(bytes ?? 0) > XML_INLINE_MAX_BYTES;

/** Nome de arquivo sugerido para o XML de UMA nota: a chave de acesso, ou número/série. */
export function nomeDoArquivoXml(
  r: Pick<NfceXmlRefRow, 'access_key' | 'number' | 'serie'>,
  kind: NfceXmlKind,
): string {
  const chave = String(r.access_key ?? '').replace(/\D/g, '');
  const base = chave.length >= 20 ? chave : `nfce-${r.number ?? 0}-${r.serie ?? 0}`;
  return `${base}-${kind}.xml`;
}
