/**
 * Diagnóstico — tipo real de cada coluna de CBS que a tela lê como booleano.
 *
 * O mapeador do Supabase trata as colunas de indicador de duas formas DIFERENTES:
 * `toBool()` (JavaScript `Boolean()`) numas e `flag()` (só 'S'/'TRUE'/'1') noutras. A
 * diferença importa: `Boolean('N')` é `true`. Se uma coluna for texto 'S'/'N' e o mapeador
 * usar `toBool`, a tela antiga já mostra errado — e copiar esse comportamento seria copiar
 * um bug.
 *
 * Só LÊ o catálogo de tipos. Nenhum dado de cliente é consultado nem impresso.
 *
 *   node scripts/diag-cbs-tipos-colunas.mjs
 */
import 'dotenv/config';
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('SUPABASE_DB_URL ausente no ambiente.');
  process.exit(2);
}

const ALVOS = {
  pb_cbs_cst_ind: [
    'ind_gibscbs', 'ind_gibscbsmono', 'ind_gred', 'ind_gdif', 'ind_gtransfcred',
    'ind_gcredpresibszfm', 'ind_gajustecompet',
    'ind_nfe', 'ind_nfce', 'ind_cte', 'ind_cteos', 'ind_bpe', 'ind_bpetm',
    'ind_nf3e', 'ind_nfcom', 'ind_nfse',
  ],
  pb_cbs_cclasstrib: [
    'incompativel_suspensao', 'requires_tax_relief_group', 'has_reduction_percentage',
    'ind_aprop_cred_adq_cbs', 'ind_aprop_cred_adq_ibs', 'ind_cred_pres_forn',
    'ind_cred_pres_adq', 'antecedent_operation_credit',
  ],
  pb_cbs_cclasstrib_ind: [
    'pred_ibs', 'pred_cbs', 'ind_redutor_bc', 'ind_gtrib_regular', 'ind_gcred_pres_oper',
    'ind_gmono_padrao', 'ind_gmono_reten', 'ind_gmono_ret', 'ind_gmono_dif', 'ind_gestorno_cred',
  ],
  pb_cbs_cclasstrib_is: [
    'incompatible_suspension', 'requires_tax_relief_group', 'has_reduction_percentage',
    'cbs_credit_appropriation_indicator', 'ibs_credit_appropriation_indicator',
    'supplier_presumed_credit_indicator', 'acquirer_presumed_credit_indicator',
  ],
  pb_cbs_is_ncm: ['tributado_is', 'ad_valorem_rate', 'ad_rem_rate', 'chapter', 'position', 'subitem'],
  pb_cbs_ccredpres: [
    'appropriates_via_invoice', 'appropriates_via_event', 'presumed_credit_deduction_indicator',
    'cbs_presumed_credit_group_indicator', 'ibs_presumed_credit_group_indicator',
    'cbs_ibs_tax_rate', 'ibs_tax_rate', 'cbs_presumed_credit_rate',
    'cbs_tax_rate_notes', 'ibs_tax_rate_notes', 'cbs_presumed_credit_rate_notes',
  ],
  pb_cbs_fund_legais: ['tax_set', 'text', 'tax_situation_code', 'tax_classification_description'],
};

const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });

try {
  for (const [tabela, colunas] of Object.entries(ALVOS)) {
    const { rows } = await pool.query(
      `select column_name, data_type
         from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_name = any($2::text[])
        order by column_name`,
      [tabela, colunas],
    );
    console.log('\n' + tabela);
    for (const r of rows) console.log(`  ${r.column_name.padEnd(38)} ${r.data_type}`);
    const faltando = colunas.filter((c) => !rows.some((r) => r.column_name === c));
    if (faltando.length) console.log('  !! não existem: ' + faltando.join(', '));

    // Para colunas de texto que a tela lê como booleano, mostrar os valores DISTINTOS.
    // São tabelas de legislação (sem dado de cliente), então listar os domínios é seguro
    // e é o que diz se 'N' aparece — o caso em que `Boolean(v)` mente.
    const textuais = rows.filter((r) => /char|text/.test(r.data_type)).map((r) => r.column_name);
    for (const c of textuais.slice(0, 20)) {
      const { rows: d } = await pool.query(
        `select distinct ${JSON.stringify(c).replace(/"/g, '"')} as v from public.${tabela} limit 6`,
      );
      const vals = d.map((x) => (x.v === null ? 'null' : JSON.stringify(String(x.v).slice(0, 18))));
      console.log(`     valores de ${c}: ${vals.join(', ')}`);
    }
  }
} finally {
  await pool.end();
}
