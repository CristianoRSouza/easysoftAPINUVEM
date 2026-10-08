import { nullableNumber, str, toInt, toIso } from '../../../common/mapping/coerce';
import type { Row } from '../../../db/queryable';
import { numStr } from './fiscal-value';

/*
 * As três listas abaixo classificam os APELIDOS que `infrastructure/nfce-detail.sql.ts`
 * devolve. Campo novo no SELECT que seja dinheiro, código ou data precisa entrar aqui.
 */

/**
 * Campos que saem como **string** por serem VALOR FISCAL. Float aqui é problema com a
 * Receita, não detalhe de formatação: `0.1 + 0.2` em ponto flutuante não dá `0.3`, e
 * numa nota autorizada o total precisa bater centavo a centavo com o XML.
 */
export const NFCE_DETAIL_MONEY_FIELDS = [
  'valor_total', 'valor_desconto', 'total_nota', 'total_produtos', 'total_desconto',
  'total_frete', 'total_seguro', 'outras_despesas', 'total_icms', 'total_icms_st',
  'total_ipi', 'total_pis', 'total_cofins', 'total_fcp', 'icms_tot_v_tot_trib',
  'tot_v_nf_tot', 'ibscbs_tot_v_bc', 'ibscbs_tot_v_ibs', 'ibscbs_tot_v_ibs_uf',
  'ibscbs_tot_v_dif_ibs_uf', 'ibscbs_tot_v_dev_trib_ibs_uf', 'ibscbs_tot_v_ibs_mun',
  'ibscbs_tot_v_dif_ibs_mun', 'ibscbs_tot_v_dev_trib_ibs_mun', 'ibscbs_tot_v_cbs',
  'ibscbs_tot_v_dif_cbs', 'ibscbs_tot_v_dev_trib_cbs',
] as const;

/** Campos numéricos de verdade (códigos e contadores), que a tela usa como número. */
export const NFCE_DETAIL_NUMBER_FIELDS = [
  'numero', 'serie', 'tipo_emissao', 'finalidade', 'retry_count', 'ambiente',
  'consumidor_final', 'indicador_presenca', 'intermediary_indicator',
  'processo_emissao', 'emitente_crt', 'destinatario_ie_indicador',
] as const;

/** Datas — sempre ISO no fio, nunca `Date` (não sobrevive ao JSON). */
export const NFCE_DETAIL_DATE_FIELDS = [
  'emissao_em', 'autorizada_em', 'cancelled_at', 'last_retry_at', 'next_retry_at',
  'manual_fix_required_at',
] as const;

/**
 * Linha do detalhe → forma do fio.
 *
 * A normalização abaixo é por CATEGORIA, não campo a campo: dinheiro vira string,
 * código vira número, data vira ISO. Uma lista de 99 `if` seria onde um campo some
 * sem ninguém notar.
 */
export function mapDetail(row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row, id: String(row.id) };
  for (const f of NFCE_DETAIL_MONEY_FIELDS) out[f] = numStr(row[f]);
  for (const f of NFCE_DETAIL_NUMBER_FIELDS) {
    // `numero`/`serie` são a identidade da nota e nunca faltam; os demais são códigos
    // fiscais opcionais, e 0 não é o mesmo que "não informado".
    out[f] = f === 'numero' || f === 'serie' ? toInt(row[f]) : nullableNumber(row[f]);
  }
  for (const f of NFCE_DETAIL_DATE_FIELDS) {
    out[f] = f === 'emissao_em' ? toIso(row[f]) : row[f] == null ? null : toIso(row[f]);
  }
  out.status = row.status != null ? String(row.status) : 'draft';
  out.emitente_cnpj = str(row.emitente_cnpj);
  out.emitente_uf = str(row.emitente_uf);
  out.emitente_razao = str(row.emitente_razao);
  return out;
}
