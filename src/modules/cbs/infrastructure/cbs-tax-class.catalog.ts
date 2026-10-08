import type { CbsDescriptor } from '../domain/cbs-descriptor';
import { RAW } from './cbs-catalog.shared';

/** Classificação tributária (cClassTrib) do IBS/CBS e do Imposto Seletivo, indicadores e tipos de documento. */
export const CBS_TAX_CLASS_TABLES: readonly CbsDescriptor[] = [
  {
    key: 'tax-class-ibscbs',
    summary: 'Classificação tributária do IBS/CBS',
    // Os percentuais de redução moram na tabela IRMÃ (`_ind`), não nesta — no browser
    // eram uma segunda consulta e um merge por `code`. Aqui é um `left join`: `code` é
    // único lá (144 linhas, 144 códigos), então ele não multiplica linha.
    //
    // `ibs_municipality_reduction_percent` repete `pred_ibs` de propósito: a nuvem guarda
    // um percentual de IBS só, e a tela tem coluna para estado e para município. Repetir
    // é o que o browser já fazia; inventar um valor diferente seria pior.
    sql: `select c.code                               as class_code,
                 c.reference_date,
                 c.description,
                 c.rate_type,
                 c.nomenclature                       as label,
                 c.desc_trat_tributario               as tax_treatment_description,
                 c.incompativel_suspensao             as incompatible_with_suspension,
                 c.requires_tax_relief_group          as requires_exemption_group,
                 c.has_reduction_percentage,
                 c.ind_aprop_cred_adq_cbs             as credit_buyer_cbs_apportionment,
                 c.ind_aprop_cred_adq_ibs             as credit_buyer_ibs_apportionment,
                 c.ind_cred_pres_forn                 as credit_presumed_supplier,
                 c.ind_cred_pres_adq                  as credit_presumed_acquirer,
                 -- esta é a única de texto no meio de sete booleanos; hoje vem toda nula
                 (upper(btrim(c.antecedent_operation_credit)) = 'S') as prior_operation_credit,
                 c.validity_start                     as valid_from,
                 c.validity_end                       as valid_to,
                 coalesce(c.updated_at, c.last_update) as updated_at,
                 i.pred_cbs                           as cbs_reduction_percent,
                 i.pred_ibs                           as ibs_state_reduction_percent,
                 i.pred_ibs                           as ibs_municipality_reduction_percent
            from public.pb_cbs_cclasstrib c
            left join public.pb_cbs_cclasstrib_ind i on i.code = c.code
           order by c.code
           limit $1`,
    numbers: ['cbs_reduction_percent', 'ibs_state_reduction_percent', 'ibs_municipality_reduction_percent'],
    nullables: [
      'rate_type', 'label', 'tax_treatment_description', 'valid_to',
      // sem isto o normalizador entrega `""` onde o contrato pede `boolean | null`, e a
      // tela mostra célula vazia em vez de "—". Pego pelo smoke de contrato.
      'prior_operation_credit',
      'cbs_reduction_percent', 'ibs_state_reduction_percent', 'ibs_municipality_reduction_percent',
    ],
    constants: { ...RAW, dfe_classification_types_json: null },
    defaultLimit: 300,
  },
  {
    key: 'tax-class-ibscbs-indicator',
    summary: 'Indicadores da classificação tributária (percentuais de redução)',
    // Os sete `*_group` NÃO são booleanos no contrato: a tela mostra a LETRA do grupo
    // ('S') quando a classificação participa dele, e célula vazia quando não. Devolver
    // `true`/`false` encheria a coluna de "false" onde deveria estar em branco.
    sql: `select code                as class_code,
                 reference_date,
                 pred_ibs            as ibs_reduction_points,
                 pred_cbs            as cbs_reduction_points,
                 ind_redutor_bc      as reduces_tax_base,
                 case when ind_gtrib_regular   then 'S' end as regular_taxation_group,
                 case when ind_gcred_pres_oper then 'S' end as presumed_credit_op_group,
                 case when ind_gmono_padrao    then 'S' end as monophasic_standard_group,
                 case when ind_gmono_reten     then 'S' end as monophasic_withholding_group,
                 case when ind_gmono_ret       then 'S' end as monophasic_substitution_group,
                 case when ind_gmono_dif       then 'S' end as monophasic_diff_group,
                 case when ind_gestorno_cred   then 'S' end as credit_reversal_group,
                 updated_at
            from public.pb_cbs_cclasstrib_ind
           order by code
           limit $1`,
    numbers: ['ibs_reduction_points', 'cbs_reduction_points'],
    nullables: [
      'ibs_reduction_points', 'cbs_reduction_points',
      // sem isto o normalizador trocaria o `null` de "não participa" por string vazia
      'regular_taxation_group', 'presumed_credit_op_group', 'monophasic_standard_group',
      'monophasic_withholding_group', 'monophasic_substitution_group', 'monophasic_diff_group',
      'credit_reversal_group',
    ],
    constants: { ...RAW, credit_recipient_notes: null },
    defaultLimit: 200,
  },
  {
    key: 'tax-class-selective-tax',
    summary: 'Classificação tributária do Imposto Seletivo',
    // Mesmos sete indicadores da classificação de IBS/CBS, com nomes de coluna
    // diferentes — esta tabela veio de outra carga e nunca foi padronizada.
    sql: `select code                               as class_code,
                 reference_date,
                 description,
                 rate_type,
                 nomenclature                       as label,
                 tax_treatment_description,
                 incompatible_suspension            as incompatible_with_suspension,
                 requires_tax_relief_group          as requires_exemption_group,
                 has_reduction_percentage,
                 cbs_credit_appropriation_indicator as credit_buyer_cbs_apportionment,
                 ibs_credit_appropriation_indicator as credit_buyer_ibs_apportionment,
                 supplier_presumed_credit_indicator as credit_presumed_supplier,
                 acquirer_presumed_credit_indicator as credit_presumed_acquirer,
                 validity_start                     as valid_from,
                 validity_end                       as valid_to,
                 coalesce(updated_at, last_update)  as updated_at
            from public.pb_cbs_cclasstrib_is
           order by code
           limit $1`,
    nullables: ['rate_type', 'label', 'tax_treatment_description', 'valid_to'],
    constants: RAW,
    defaultLimit: 80,
  },
  {
    key: 'tax-class-ibscbs-type',
    summary: 'Tipos de documento por classificação tributária',
    // A tabela guarda só o id da classificação; a tela mostra o CÓDIGO dela.
    sql: `select c.code            as class_code,
                 c.reference_date  as reference_date,
                 t.abbreviation    as acronym,
                 t.type            as type_code,
                 t.description     as description
            from public.pb_cbs_cclasstrib_dfe_types t
            left join public.pb_cbs_cclasstrib c on c.id = t.cbs_ct_cbs_ibs_id
           order by c.code, t.abbreviation
           limit $1`,
    nullables: ['type_code'],
    constants: RAW,
    defaultLimit: 700,
  },
];
