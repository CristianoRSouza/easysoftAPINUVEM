/**
 * Smoke — as rotas de CBS devolvem o que a TELA lê?
 *
 * A conferência estática (nomes no SQL × nomes na interface) pega o campo que falta. Não
 * pega o campo que existe com o TIPO errado — número onde a tela espera texto, `false`
 * onde ela espera célula vazia. Ligar essas rotas sem esta prova foi o que quebrou a
 * Reforma Tributária em produção.
 *
 * Aqui cada rota é chamada de verdade, contra o banco real, e cada linha é conferida
 * contra o contrato: campo presente? tipo compatível? tudo nulo (sinal de apelido errado)?
 *
 *   node scripts/smoke-cbs-contrato.mjs
 *
 * Só LÊ tabelas de legislação — não há dado de cliente aqui. Nenhuma credencial é impressa.
 */
import 'dotenv/config';
import pg from 'pg';
import { CBS_CATALOG, CBS_MUNICIPALITY_WITH_RATE_BY_UF_SQL } from '../dist/modules/cbs/infrastructure/cbs.catalog.js';
// O normalizador REAL do service — ver o comentario dele. Uma copia aqui faria este
// smoke conferir a copia em vez da rota.
import { normalize } from '../dist/modules/cbs/domain/cbs.mapper.js';

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('SUPABASE_DB_URL ausente no ambiente.');
  process.exit(2);
}

/**
 * O contrato de cada rota: campo -> tipo aceito.
 *   's'  texto (ou null quando o nome termina em `?`)
 *   'n'  número
 *   'b'  booleano
 *   '*'  qualquer coisa, inclusive null
 * Copiado das interfaces `Cbs*` do Manager — se elas mudarem, este arquivo tem de mudar.
 */
const CONTRATO = {
  'union-reference-rate': {
    reference_date: 's', valid_from: 's', 'valid_to?': 's', reference_rate: '*',
    own_rate: '*', updated_at: 's', 'raw_json?': '*',
  },
  'state-reference-rate': {
    state_code: 'n', reference_date: 's', 'valid_from?': 's', 'valid_to?': 's',
    'reference_rate?': 'n', 'own_rate?': 'n', updated_at: 's', 'raw_json?': '*',
  },
  state: { code: 'n', abbreviation: 's', name: 's', updated_at: 's', 'raw_json?': '*' },
  'cst-ibscbs': {
    api_record_id: 'n', reference_date: 's', cst_code: 's', description: 's',
    valid_from: 's', 'valid_to?': 's', 'label?': 's', updated_at: 's', 'raw_json?': '*',
  },
  'cst-ibscbs-indicator': {
    cst_code: 's',
    group_ibscbs: 'b', group_ibscbs_monophasic: 'b', group_reduction: 'b',
    group_differential: 'b', group_credit_transfer: 'b', group_presumed_zfm: 'b',
    group_competence_adjust: 'b',
    allows_nfe: 'b', allows_nfce: 'b', allows_cte: 'b', allows_cte_os: 'b',
    allows_bpe: 'b', allows_bpe_tm: 'b', allows_nf3e: 'b', allows_nfcom: 'b', allows_nfse: 'b',
  },
  'cst-selective-tax': {
    api_record_id: 'n', reference_date: 's', cst_code: 's', description: 's',
    valid_from: 's', 'valid_to?': 's', updated_at: 's', 'raw_json?': '*',
  },
  'tax-class-ibscbs': {
    class_code: 's', reference_date: 's', description: 's', 'rate_type?': 's',
    'label?': 's', 'tax_treatment_description?': 's',
    'incompatible_with_suspension?': 'b', 'requires_exemption_group?': 'b',
    'has_reduction_percentage?': 'b', 'credit_buyer_cbs_apportionment?': 'b',
    'credit_buyer_ibs_apportionment?': 'b', 'credit_presumed_supplier?': 'b',
    'credit_presumed_acquirer?': 'b', 'prior_operation_credit?': 'b',
    valid_from: 's', 'valid_to?': 's', 'raw_json?': '*', updated_at: 's',
    'cbs_reduction_percent?': 'n', 'ibs_state_reduction_percent?': 'n',
    'ibs_municipality_reduction_percent?': 'n', 'dfe_classification_types_json?': '*',
  },
  'tax-class-ibscbs-type': {
    class_code: 's', reference_date: 's', acronym: 's', 'type_code?': 's', description: 's',
  },
  'tax-class-ibscbs-indicator': {
    class_code: 's', 'ibs_reduction_points?': 'n', 'cbs_reduction_points?': 'n',
    'reduces_tax_base?': 'b', 'regular_taxation_group?': 's', 'presumed_credit_op_group?': 's',
    'monophasic_standard_group?': 's', 'monophasic_withholding_group?': 's',
    'monophasic_substitution_group?': 's', 'monophasic_diff_group?': 's',
    'credit_reversal_group?': 's', 'credit_recipient_notes?': '*',
  },
  'tax-class-selective-tax': {
    class_code: 's', reference_date: 's', description: 's', 'rate_type?': 's',
    'tax_treatment_description?': 's', 'incompatible_with_suspension?': 'b',
    'requires_exemption_group?': 'b', 'has_reduction_percentage?': 'b',
    'credit_buyer_cbs_apportionment?': 'b', 'credit_buyer_ibs_apportionment?': 'b',
    'credit_presumed_supplier?': 'b', 'credit_presumed_acquirer?': 'b',
    valid_from: 's', 'valid_to?': 's', updated_at: 's',
  },
  'selective-tax-ncm': {
    ncm: 's', reference_date: 's', subject_to_selective_tax: 'b',
    'ad_valorem_rate?': 's', 'specific_rate?': 's', 'chapter_summary?': 's',
    'schedule_position?': 's', 'subitem_detail?': 's',
    valid_from: 's', 'valid_to?': 's', 'raw_json?': '*', updated_at: 's',
  },
  'presumed-credit-rule': {
    rule_id: 's', reference_date: 's', description: 's', 'lc214_2025_body?': '*',
    credit_via_nfe: 'b', credit_via_event: 'b', deduct_presumed_credit: 'b',
    group_includes_cbs_presumed: 'b', group_includes_ibs_presumed: 'b',
    'cbs_rate?': 's', 'ibs_rate?': 's', 'presumed_credit_cbs_rate?': 's',
    'referenced_invoice_class?': 's', valid_from: 's', 'valid_to?': 's',
    'cbs_rate_notes?': 's', 'ibs_rate_notes?': 's', 'presumed_cbs_rate_notes?': 's',
  },
  'legal-basis': {
    tax_class_code: 's', reference_date: 's', tax_class_description: 's',
    'tax_situation_code?': 's', 'tax_situation_description?': 's', 'tax_subset_label?': 's',
    'full_text?': 's', 'summary_text?': '*', 'statutory_reference?': '*',
    valid_from: 's', 'valid_to?': 's', 'raw_json?': '*', updated_at: 's',
  },
  'municipality-reference-rate': {
    municipality_code: 'n', reference_date: 's', 'valid_from?': 's', 'valid_to?': 's',
    'reference_rate?': 'n', updated_at: 's', 'raw_json?': '*',
  },
};

const pool = new pg.Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });

const tipoOk = (v, t) =>
  t === '*' ? true : t === 'n' ? typeof v === 'number' : t === 'b' ? typeof v === 'boolean' : typeof v === 'string';

let falhas = 0;
const avisos = [];
try {
  for (const [rota, contrato] of Object.entries(CONTRATO)) {
    const d = CBS_CATALOG.find((x) => x.key === rota);
    if (!d) { console.log(`✗ ${rota}: não existe no catálogo`); falhas++; continue; }
    const params = d.sql.includes('$2') ? [50, null] : [50];
    const { rows } = await pool.query(d.sql, params);
    const linhas = rows.map((r) => normalize(r, d));
    const problemas = [];

    if (linhas.length === 0) problemas.push('rota não devolveu NENHUMA linha');

    for (const [campoRaw, tipo] of Object.entries(contrato)) {
      const opcional = campoRaw.endsWith('?');
      const campo = opcional ? campoRaw.slice(0, -1) : campoRaw;
      const ausentes = linhas.filter((l) => !(campo in l)).length;
      if (ausentes) { problemas.push(`${campo}: AUSENTE em ${ausentes}/${linhas.length} linhas`); continue; }
      const errados = linhas.filter((l) => {
        const v = l[campo];
        if (v === null) return !opcional && tipo !== '*';
        return !tipoOk(v, tipo);
      });
      if (errados.length) {
        const amostra = JSON.stringify(errados[0][campo]);
        problemas.push(`${campo}: tipo errado em ${errados.length}/${linhas.length} (esperado ${tipo}, veio ${amostra})`);
        continue;
      }
      // Campo inteiramente vazio TAMBÉM é o sintoma do apelido errado — mas é o sintoma
      // de coluna nula no banco, e isso é comum aqui: `validity_end`, `nomenclature` e
      // `desc_trat_tributario` estão 100% nulas em produção hoje. Conferido coluna a
      // coluna: nenhuma delas é apelido errado. Por isso AVISO, não reprovação — tratar
      // como erro faria a suíte nascer vermelha e ser ignorada, que é pior que não ter.
      const constante = campo in (d.constants ?? {});
      const todosVazios = linhas.every((l) => l[campo] === null || l[campo] === '');
      if (todosVazios && !constante) avisos.push(`${rota}.${campo}: vazio em todas as ${linhas.length} linhas`);
    }

    if (problemas.length) {
      falhas++;
      console.log(`✗ ${rota}  (${linhas.length} linhas)`);
      for (const p of problemas) console.log(`     ${p}`);
    } else {
      console.log(`✓ ${rota}  (${linhas.length} linhas, ${Object.keys(contrato).length} campos conferidos)`);
    }
  }

  // A rota de municípios não é do catálogo — tem service próprio.
  const { rows } = await pool.query(CBS_MUNICIPALITY_WITH_RATE_BY_UF_SQL, ['SP']);
  const esperados = ['code', 'name', 'state_abbreviation', 'updated_at', 'reference_rate', 'reference_date', 'valid_from', 'valid_to', 'rate_updated_at'];
  const faltando = esperados.filter((c) => !(c in (rows[0] ?? {})));
  const comAliquota = rows.filter((r) => r.reference_rate != null).length;
  if (faltando.length || rows.length === 0) {
    falhas++;
    console.log(`✗ municipality-with-rate-by-uf: faltam ${faltando.join(', ') || '(nenhuma linha)'}`);
  } else {
    console.log(`✓ municipality-with-rate-by-uf  (SP: ${rows.length} linhas, ${comAliquota} com alíquota)`);
  }
} finally {
  await pool.end();
}

console.log(falhas ? `\n${falhas} rota(s) reprovada(s).` : '\nTodas as rotas conferem com o contrato da tela.');
process.exit(falhas ? 1 : 0);
