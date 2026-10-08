import { z } from 'zod';

/** Extensões de imagem aceitas — casam com o guessContentType do Sync-PG-SB. */
export const IMAGE_EXTS = ['.jpg', '.png', '.webp', '.gif'] as const;

/**
 * POST /storage/product-images — metadados (multipart). O arquivo vai em `file`.
 * companyId/productId compõem o object path `${companyId}/${productId}${ext}` (mesmo do SDK).
 */
export const productImageMetaSchema = z.object({
  companyId: z.string().uuid(),
  productId: z.string().uuid(),
  // O Sync já normaliza a extensão (.jpeg -> .jpg) antes de enviar.
  ext: z.enum(IMAGE_EXTS),
});
export type ProductImageMeta = z.infer<typeof productImageMetaSchema>;

/**
 * POST /storage/nfce-certificates — metadados (multipart). O PFX vai em `file`.
 * Object path `${companyId}/${certificateId}.pfx` (mesmo do SDK).
 */
export const nfceCertificateMetaSchema = z.object({
  companyId: z.string().uuid(),
  certificateId: z.string().uuid(),
});
export type NfceCertificateMeta = z.infer<typeof nfceCertificateMetaSchema>;

/**
 * POST /storage/fiscal-xml — metadados (multipart). O XML vai em `file`.
 *
 * ── POR QUE UMA UNIÃO, E NÃO UM SCHEMA COM TUDO OPCIONAL ──────────────────────
 * São três documentos com três formatos de caminho (nota, evento, inutilização) e campos
 * que não se sobrepõem: inutilização não tem chave de acesso, evento não tem `issuedAt`
 * próprio. Um objeto único com dez campos opcionais aceitaria a combinação errada e só
 * falharia lá na frente, ao montar o caminho — com o arquivo já no ar. Aqui o payload
 * híbrido é recusado na porta.
 *
 * ── `z.coerce` NOS NÚMEROS NÃO É ENFEITE ──────────────────────────────────────
 * Isto chega por **multipart**: todo campo vem como string, inclusive `year` e `serie`.
 * Um `z.number()` puro recusaria `"2026"`. As outras duas rotas de storage não tropeçaram
 * nisso porque só têm uuid e enum.
 *
 * Note que NÃO há campo de caminho: quem deriva o object path é a API
 * (`fiscal-xml-path.ts`). Aceitar um caminho do cliente seria deixá-lo escrever em
 * qualquer lugar de um bucket compartilhado entre produtos.
 */
const tenantEModelo = {
  companyId: z.string().uuid(),
  storeId: z.string().uuid(),
  /** 65 = NFC-e, 55 = NF-e. Mora no caminho porque o bucket é compartilhado. */
  model: z.enum(['55', '65']),
};

/**
 * Identidade da nota, para a PASTA. `accessKey` é o normal; os outros três só entram no
 * fallback de nota sem chave (rejeitada/rascunho) — ver `nomeBaseDaNota`.
 */
const identidadeDaNota = {
  accessKey: z.string().optional(),
  number: z.coerce.number().int().optional(),
  serie: z.coerce.number().int().optional(),
  noteId: z.string().uuid().optional(),
};

export const fiscalXmlMetaSchema = z.discriminatedUnion('documento', [
  z.object({
    ...tenantEModelo,
    ...identidadeDaNota,
    documento: z.literal('nota'),
    /** STRING ISO com o offset do emitente preservado — NUNCA um Date serializado em UTC. */
    issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'issuedAt deve começar em YYYY-MM-DD'),
    kind: z.enum(['authorized', 'signed', 'cancellation']),
  }),
  z.object({
    ...tenantEModelo,
    ...identidadeDaNota,
    documento: z.literal('evento'),
    /** Data da NOTA, não do evento: o evento mora no mês fiscal do documento que ele altera. */
    noteIssuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'noteIssuedAt deve começar em YYYY-MM-DD'),
    eventType: z.string().min(1),
    eventSequence: z.coerce.number().int().nonnegative(),
    kind: z.enum(['request', 'response']),
  }),
  z.object({
    ...tenantEModelo,
    documento: z.literal('inutilizacao'),
    year: z.coerce.number().int(),
    serie: z.coerce.number().int(),
    numberStart: z.coerce.number().int(),
    numberEnd: z.coerce.number().int(),
  }),
]);
export type FiscalXmlMeta = z.infer<typeof fiscalXmlMetaSchema>;
