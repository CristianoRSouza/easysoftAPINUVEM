import type { CbsDescriptor } from '../domain/cbs-descriptor';
import { RAW } from './cbs-catalog.shared';

/** Códigos de situação tributária (CST) do IBS/CBS e do Imposto Seletivo, e seus indicadores. */
export const CBS_CST_TABLES: readonly CbsDescriptor[] = [
  {
    key: 'cst-ibscbs',
    summary: 'CST do IBS/CBS',
    sql: `select id_api                             as api_record_id,
                 reference_date,
                 code                               as cst_code,
                 description,
                 validity_start                     as valid_from,
                 validity_end                       as valid_to,
                 nomenclature                       as label,
                 coalesce(updated_at, last_update)  as updated_at
            from public.pb_cbs_cst
           order by code
           limit $1`,
    numbers: ['api_record_id'],
    nullables: ['valid_to', 'label'],
    constants: RAW,
    defaultLimit: 120,
  },
  {
    key: 'cst-selective-tax',
    summary: 'CST do Imposto Seletivo',
    sql: `select id_api                             as api_record_id,
                 reference_date,
                 code                               as cst_code,
                 description,
                 validity_start                     as valid_from,
                 validity_end                       as valid_to,
                 coalesce(updated_at, last_update)  as updated_at
            from public.pb_cbs_cst_is
           order by code
           limit $1`,
    numbers: ['api_record_id'],
    nullables: ['valid_to'],
    constants: RAW,
    defaultLimit: 120,
  },
  {
    key: 'cst-ibscbs-indicator',
    summary: 'Indicadores por CST do IBS/CBS',
    // Sem `reference_date`: esta tabela não tem a coluna (ao contrário das irmãs
    // pb_cbs_cst e pb_cbs_cclasstrib_ind). Pego pelo smoke contra o banco real.
    //
    // As 16 colunas de indicador NÃO são do mesmo tipo, e isso muda a conversão:
    // os sete `ind_g*` (grupo) são `boolean` de verdade; os nove de DFE (`ind_nfe` e
    // companhia) são `text` com 'S'/'N'. Devolver o texto cru faria a tela tratar "N"
    // como verdadeiro — em JavaScript `Boolean('N')` é `true`. Daí o `= 'S'`.
    sql: `select code                              as cst_code,
                 coalesce(ind_gibscbs, false)      as group_ibscbs,
                 coalesce(ind_gibscbsmono, false)  as group_ibscbs_monophasic,
                 coalesce(ind_gred, false)         as group_reduction,
                 coalesce(ind_gdif, false)         as group_differential,
                 coalesce(ind_gtransfcred, false)  as group_credit_transfer,
                 coalesce(ind_gcredpresibszfm, false) as group_presumed_zfm,
                 coalesce(ind_gajustecompet, false)   as group_competence_adjust,
                 coalesce(upper(btrim(ind_nfe))   = 'S', false) as allows_nfe,
                 coalesce(upper(btrim(ind_nfce))  = 'S', false) as allows_nfce,
                 coalesce(upper(btrim(ind_cte))   = 'S', false) as allows_cte,
                 coalesce(upper(btrim(ind_cteos)) = 'S', false) as allows_cte_os,
                 coalesce(upper(btrim(ind_bpe))   = 'S', false) as allows_bpe,
                 coalesce(upper(btrim(ind_bpetm)) = 'S', false) as allows_bpe_tm,
                 coalesce(upper(btrim(ind_nf3e))  = 'S', false) as allows_nf3e,
                 coalesce(upper(btrim(ind_nfcom)) = 'S', false) as allows_nfcom,
                 coalesce(upper(btrim(ind_nfse))  = 'S', false) as allows_nfse,
                 updated_at
            from public.pb_cbs_cst_ind
           order by code
           limit $1`,
    constants: RAW,
    defaultLimit: 120,
  },
];
