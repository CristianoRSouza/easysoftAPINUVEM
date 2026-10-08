/**
 * Regras de upload que não dependem de onde o arquivo vai parar: tetos, tipo do conteúdo e
 * o caminho dos objetos que NÃO são documento fiscal (o do XML está em `fiscal-xml-path.ts`).
 */

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PFX_BYTES = 5 * 1024 * 1024;
/** Teto do bucket `fiscal-xml`. Uma NFC-e tem ~8 KB; 10 MB é folga, não expectativa. */
export const MAX_FISCAL_XML_BYTES = 10 * 1024 * 1024;

/** Conflito de objeto no Storage. Para o XML fiscal isso é sucesso — ver `uploadFiscalXml`. */
const CONFLITO_NO_STORAGE = /already exists|duplicate|resource already/i;

export const ehConflitoNoStorage = (mensagem: string): boolean =>
  CONFLITO_NO_STORAGE.test(mensagem);

/** contentType por extensão — MESMA regra do guessContentType do Sync-PG-SB. */
export function imageContentType(ext: string): string {
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

/** `${companyId}/${productId}${ext}` — o mesmo path do SDK que rodava na loja. */
export const caminhoDaImagemDoProduto = (p: {
  companyId: string;
  productId: string;
  ext: string;
}): string => `${p.companyId}/${p.productId}${p.ext}`;

/** `${companyId}/${certificateId}.pfx` — o mesmo path do SDK que rodava na loja. */
export const caminhoDoPfx = (p: { companyId: string; certificateId: string }): string =>
  `${p.companyId}/${p.certificateId}.pfx`;
