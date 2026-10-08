import { z } from 'zod';

/**
 * NFC-e — leitura das notas e do que pendura nelas.
 *
 * ⚠️ DIFERENÇA DE SEGURANÇA em relação ao que o browser faz hoje.
 * As funções da nuvem para pagamentos, logs e eventos filtram **apenas por `note_id`** —
 * o `store_id` é lido do tenant, checado como "existe?" e então **não entra na consulta**.
 * No navegador isso era seguro porque a RLS do Supabase barrava a nota de outra loja.
 *
 * O role desta API tem `BYPASSRLS` de propósito (ver `sql/least-privilege-role.sql`), então
 * repetir o mesmo filtro aqui seria um vazamento entre empresas: bastaria um `note_id`
 * alheio. Por isso toda rota filha **amarra a nota à loja** antes de devolver qualquer
 * coisa, e nota de outra loja responde lista vazia — não 404, para a rota não virar
 * verificador de existência de nota alheia.
 */

export const nfceListQuerySchema = z.object({
  status: z.string().max(40).optional(),
  reconcileStatus: z.string().max(40).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Casa com chave de acesso, protocolo ou número da nota. */
  search: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type NfceListQuery = z.infer<typeof nfceListQuerySchema>;

/**
 * Filtros do ZIP de XML. São os MESMOS da listagem, menos `page`/`limit` — o download
 * leva tudo o que casa com o filtro, não a página que está na tela. Reusar o schema (em
 * vez de redigitar os campos) é o que garante que os dois nunca divirjam: se amanhã a
 * lista ganhar um filtro novo, o download ganha junto.
 */
export const nfceXmlArchiveQuerySchema = nfceListQuerySchema.omit({ page: true, limit: true });
export type NfceXmlArchiveQuery = z.infer<typeof nfceXmlArchiveQuerySchema>;

/** Filtros dos totais dos cards. Também os mesmos da listagem, sem `page`/`limit`. */
export const nfceTotalsQuerySchema = nfceListQuerySchema.omit({ page: true, limit: true });
export type NfceTotalsQuery = z.infer<typeof nfceTotalsQuerySchema>;

/**
 * Totais dos cards do topo da tela — do PERÍODO inteiro, não da página.
 *
 * `porStatus` vem com a chave CRUA do banco (minúscula), não normalizada. A tela já tem
 * `normalizeNfceStatus` para dobrar os apelidos (`inutilizada` → `inutilized`); repetir
 * esse mapa aqui criaria dois lugares para manter, e o dia em que divergissem o card
 * mostraria um número e a linha da tabela outro.
 *
 * `valorAutorizado` viaja como **string**: é soma de valor fiscal, e ponto flutuante em
 * documento fiscal é problema com a Receita, não detalhe de formatação.
 */
export const nfceTotalsSchema = z.object({
  total: z.number(),
  porStatus: z.record(z.string(), z.number()),
  valorAutorizado: z.string(),
});
export type NfceTotals = z.infer<typeof nfceTotalsSchema>;

/**
 * Resumo da nota na listagem. Nomes em português porque é o contrato que a tela já
 * consome — renomear seria mexer na tela sem ganho nenhum agora.
 *
 * `valor_total` viaja como **string**, não número: é valor fiscal, e arredondamento de
 * ponto flutuante em documento fiscal é problema com a Receita, não detalhe de formatação.
 */
export const nfceSummarySchema = z.object({
  id: z.string(),
  numero: z.number(),
  serie: z.number(),
  chave_acesso: z.string().nullable(),
  status: z.string(),
  valor_total: z.string(),
  valor_desconto: z.string(),
  emissao_em: z.string(),
  autorizada_em: z.string().nullable(),
  protocolo: z.string().nullable(),
  codigo_retorno: z.string().nullable(),
  motivo_retorno: z.string().nullable(),
  tipo_emissao: z.number().nullable(),
  reconcile_status: z.string().nullable(),
  retry_count: z.number().nullable(),
  order_id: z.string().nullable(),
  qrcode: z.string().nullable(),
  emitente_cnpj: z.string(),
  emitente_razao: z.string(),
  emitente_fantasia: z.string().nullable(),
  emitente_uf: z.string(),
  destinatario_cpf: z.string().nullable(),
  destinatario_nome: z.string().nullable(),
  qtd_itens: z.number(),
  formas_pagamento: z.string().nullable(),
});
export type NfceSummary = z.infer<typeof nfceSummarySchema>;

export const nfceListResultSchema = z.object({
  data: z.array(nfceSummarySchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type NfceListResult = z.infer<typeof nfceListResultSchema>;

/**
 * Detalhe da nota — a nota mais as 5 tabelas filhas, achatadas em ~99 campos.
 *
 * **Passthrough de propósito.** Enumerar as 99 chaves aqui daria uma lista que precisa
 * ser mantida em sincronia com o SELECT, e o dia em que as duas divergirem o campo some
 * da tela fiscal em silêncio. Em vez disso, o rename é feito no próprio SQL (ver
 * `nfce-detail.sql.ts`) — coluna errada quebra a consulta na hora — e aqui travamos só o
 * que a tela não pode receber errado:
 *
 *   • `id` e `numero` existem sempre (é a identidade da nota);
 *   • os totais viajam como **string**, porque são valor fiscal. Float não é detalhe de
 *     formatação: `0.1 + 0.2` não dá `0.3`, e o total de uma nota autorizada precisa
 *     bater centavo a centavo com o XML enviado à SEFAZ.
 */
export const nfceDetailSchema = z
  .object({
    id: z.string(),
    numero: z.number(),
    serie: z.number(),
    status: z.string(),
    valor_total: z.string(),
    total_nota: z.string(),
    emitente_cnpj: z.string(),
    emitente_uf: z.string(),
    emissao_em: z.string(),
  })
  .passthrough();
export type NfceDetail = z.infer<typeof nfceDetailSchema>;

export const nfceAttentionCountsSchema = z.object({
  manualReview: z.number(),
  reconcileFailed: z.number(),
  unusable: z.number(),
});
export type NfceAttentionCounts = z.infer<typeof nfceAttentionCountsSchema>;

export const nfcePaymentSchema = z.object({
  seq: z.number(),
  forma_pagamento: z.string(),
  forma_descricao: z.string(),
  valor: z.string(),
  troco: z.string().nullable(),
  tipo_integracao: z.number().nullable(),
  integracao_descricao: z.string().nullable(),
  bandeira_cartao: z.string().nullable(),
  bandeira_descricao: z.string().nullable(),
  nsu_autorizacao: z.string().nullable(),
  cnpj_credenciadora: z.string().nullable(),
});
export type NfcePayment = z.infer<typeof nfcePaymentSchema>;

export const nfceLogSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  type: z.string().nullable(),
  level: z.string(),
  message: z.string(),
  details: z.string().nullable(),
  previous_status: z.string().nullable(),
  new_status: z.string().nullable(),
  return_code: z.string().nullable(),
  protocol: z.string().nullable(),
  user_name: z.string().nullable(),
});
export type NfceLog = z.infer<typeof nfceLogSchema>;

export const nfceEventSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  event_description: z.string().nullable(),
  event_sequence: z.number(),
  event_at: z.string(),
  justification: z.string().nullable(),
  correction: z.string().nullable(),
  protocol: z.string().nullable(),
  sefaz_status_code: z.string().nullable(),
  sefaz_status_reason: z.string().nullable(),
  registered_at: z.string().nullable(),
  situation: z.string().nullable(),
  created_at: z.string(),
});
export type NfceEvent = z.infer<typeof nfceEventSchema>;

/** Rótulos fiscais — o mesmo mapa que a tela usa hoje (tabela do layout da NFC-e). */
export const NFCE_PAYMENT_LABELS: Record<string, string> = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de Crédito',
  '04': 'Cartão de Débito',
  '05': 'Crédito Loja',
  '10': 'Vale Alimentação',
  '11': 'Vale Refeição',
  '12': 'Vale Presente',
  '13': 'Vale Combustível',
  '15': 'Boleto Bancário',
  '16': 'Depósito Bancário',
  '17': 'PIX',
  '18': 'Transferência bancária',
  '19': 'Programa de fidelidade',
  '90': 'Sem pagamento',
  '99': 'Outros',
};

export const NFCE_CARD_BRANDS: Record<string, string> = {
  '01': 'Visa',
  '02': 'Mastercard',
  '03': 'American Express',
  '04': 'Sorocred',
  '05': 'Diners Club',
  '06': 'Elo',
  '07': 'Hipercard',
  '08': 'Aura',
  '09': 'Cabal',
  '99': 'Outros',
};
