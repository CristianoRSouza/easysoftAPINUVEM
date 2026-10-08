import { nullableNumber, nullableStr, str, toInt } from '../../../common/mapping/coerce';
import type { Row } from '../../../db/queryable';
import { numStr } from './fiscal-value';

/*
 * As listas abaixo classificam os APELIDOS que `infrastructure/nfce-items.sql.ts` devolve.
 */

/**
 * Campos de VALOR FISCAL — saem como string. Os que podem faltar saem `null`, não `"0"`:
 * imposto não informado é diferente de imposto zero numa nota, e a tela mostra os dois
 * de forma diferente.
 */
export const NFCE_ITEM_MONEY_NULLABLE = [
  'desconto', 'frete', 'seguro', 'outras_despesas',
  'icms_bc', 'icms_aliquota', 'icms_valor', 'icms_st_valor', 'icms_fcp_valor',
  'sn_aliq_credito', 'sn_valor_credito',
  'pis_bc', 'pis_aliquota', 'pis_valor', 'pis_bc_quantity', 'pis_rate_reais',
  'cofins_bc', 'cofins_aliquota', 'cofins_valor', 'cofins_bc_quantity',
  'cofins_rate_reais', 'total_tributos', 'rtrib_v_item',
] as const;

/** Valores que a nota sempre traz — string, nunca null. */
export const NFCE_ITEM_MONEY_REQUIRED = [
  'quantidade', 'preco_unitario', 'valor_bruto',
] as const;

/** Texto obrigatório (vazio quando ausente) e texto opcional (null quando ausente). */
export const NFCE_ITEM_TEXT_REQUIRED = [
  'codigo_produto', 'descricao', 'ncm', 'cfop', 'unidade',
] as const;
export const NFCE_ITEM_TEXT_NULLABLE = [
  'ean', 'cest', 'info_adicional', 'scale_indicator', 'icms_cst_csosn', 'pis_cst', 'cofins_cst',
] as const;

/** Linha de item (com os impostos já juntados pelo SQL) → forma do fio. */
export function mapItem(r: Row): Record<string, unknown> {
  const out: Record<string, unknown> = { item: toInt(r.item) };
  for (const f of NFCE_ITEM_TEXT_REQUIRED) out[f] = str(r[f]);
  for (const f of NFCE_ITEM_TEXT_NULLABLE) out[f] = nullableStr(r[f]);
  for (const f of NFCE_ITEM_MONEY_REQUIRED) out[f] = numStr(r[f]);
  // Imposto ausente é `null`, não "0": nota sem o imposto e nota com imposto zerado
  // são coisas diferentes, e a tela fiscal mostra cada uma de um jeito.
  for (const f of NFCE_ITEM_MONEY_NULLABLE) out[f] = r[f] == null ? null : String(r[f]);
  out.icms_origem = nullableNumber(r.icms_origem);
  return out;
}
