import type { CbsDescriptor } from '../domain/cbs-descriptor';
import { RAW } from './cbs-catalog.shared';

/** NCM do Imposto Seletivo, regras de crédito presumido e fundamentos legais. */
export const CBS_LEGISLATION_TABLES: readonly CbsDescriptor[] = [
  {
    key: 'selective-tax-ncm',
    summary: 'NCM tributados pelo Imposto Seletivo',
    // As duas alíquotas são `numeric` no banco mas o contrato da tela pede TEXTO — ela
    // exibe o valor como veio, sem arredondar. Por isso ficam fora de `numbers`: o
    // normalizador as devolveria como número e a tela perderia as casas à direita.
    sql: `select ncm,
                 reference_date,
                 tributado_is                       as subject_to_selective_tax,
                 ad_valorem_rate,
                 ad_rem_rate                        as specific_rate,
                 chapter                            as chapter_summary,
                 position                           as schedule_position,
                 subitem                            as subitem_detail,
                 validity_start                     as valid_from,
                 validity_end                       as valid_to,
                 coalesce(updated_at, last_update)  as updated_at
            from public.pb_cbs_is_ncm
           order by ncm
           limit $1`,
    nullables: [
      'ad_valorem_rate', 'specific_rate', 'valid_to',
      'chapter_summary', 'schedule_position', 'subitem_detail',
    ],
    constants: RAW,
    defaultLimit: 300,
  },
  {
    key: 'presumed-credit-rule',
    summary: 'Regras de crédito presumido',
    // As três alíquotas vão como TEXTO pelo mesmo motivo do Imposto Seletivo por NCM: a
    // tela mostra o número como está publicado, e virar `number` come as casas decimais.
    //
    // `lc214_2025_body` é constante nula: a coluna existe no PostgreSQL da loja (veio do
    // dataset do governo com o corpo da LC 214/2025) e não foi replicada para a nuvem.
    // Some da tela nos dois caminhos — o que muda é que aqui isso está declarado.
    sql: `select code                                as rule_id,
                 reference_date,
                 description,
                 appropriates_via_invoice            as credit_via_nfe,
                 appropriates_via_event              as credit_via_event,
                 presumed_credit_deduction_indicator as deduct_presumed_credit,
                 cbs_presumed_credit_group_indicator as group_includes_cbs_presumed,
                 ibs_presumed_credit_group_indicator as group_includes_ibs_presumed,
                 cbs_ibs_tax_rate                    as cbs_rate,
                 ibs_tax_rate                        as ibs_rate,
                 cbs_presumed_credit_rate            as presumed_credit_cbs_rate,
                 cbs_tax_rate_notes                  as cbs_rate_notes,
                 ibs_tax_rate_notes                  as ibs_rate_notes,
                 cbs_presumed_credit_rate_notes      as presumed_cbs_rate_notes,
                 referenced_invoice_class,
                 validity_start                      as valid_from,
                 validity_end                        as valid_to,
                 updated_at
            from public.pb_cbs_ccredpres
           order by code
           limit $1`,
    nullables: [
      'cbs_rate', 'ibs_rate', 'presumed_credit_cbs_rate',
      'cbs_rate_notes', 'ibs_rate_notes', 'presumed_cbs_rate_notes',
      'referenced_invoice_class', 'valid_to',
    ],
    constants: { ...RAW, lc214_2025_body: null },
    defaultLimit: 120,
  },
  {
    key: 'legal-basis',
    summary: 'Fundamentos legais',
    // `short_text`/`normative_reference` vieram na migração 20260930006000 do V2: são o
    // `textoCurto` e a `referenciaNormativa` da data-api, que a loja guarda como
    // `summary_text` e `statutory_reference`.
    sql: `select tax_classification_code            as tax_class_code,
                 tax_situation_code,
                 tax_classification_description     as tax_class_description,
                 tax_situation_description,
                 tax_set                            as tax_subset_label,
                 text                               as full_text,
                 short_text                         as summary_text,
                 normative_reference                as statutory_reference,
                 reference_date,
                 validity_start                     as valid_from,
                 validity_end                       as valid_to,
                 coalesce(updated_at, last_update)  as updated_at
            from public.pb_cbs_fund_legais
           order by tax_classification_code, tax_situation_code
           limit $1`,
    nullables: [
      'tax_situation_code', 'tax_situation_description',
      'tax_subset_label', 'full_text', 'summary_text', 'statutory_reference', 'valid_to',
    ],
    constants: { ...RAW },
    defaultLimit: 300,
  },
];
