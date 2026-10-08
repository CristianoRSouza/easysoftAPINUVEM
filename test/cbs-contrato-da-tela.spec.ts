import { describe, expect, it } from 'vitest';
import { CBS_CATALOG, CBS_MUNICIPALITY_WITH_RATE_BY_UF_SQL } from '../src/modules/cbs/infrastructure/cbs.catalog';

/**
 * As rotas de CBS devolvem os nomes de campo que a TELA lê?
 *
 * Este arquivo existe por causa de um estrago real. As 14 rotas de CBS foram ligadas de
 * uma vez, sem conferir nomes de campo, e a tela da Reforma Tributária foi para produção
 * com as tabelas montando e todas as células vazias. Nove das quatorze devolviam o nome
 * da COLUNA (`type`, `ind_gibscbs`, `rule_code`) onde a tela lia o nome do CONTRATO
 * (`type_code`, `group_ibscbs`, `rule_id`).
 *
 * O que torna esse erro perigoso é não parecer erro: a rota responde 200, a tela carrega,
 * ninguém vê exceção. Só olhando a tela dá para notar — e foi assim que se notou.
 *
 * Aqui a lista abaixo é o contrato, copiado das interfaces `Cbs*` do Manager
 * (`src/lib/mock-data.ts`). Mudou lá, tem de mudar aqui — e é essa quebra proposital que
 * obriga a olhar os dois lados.
 *
 * O que este teste NÃO cobre: se o VALOR está certo, e se o tipo bate. Nome certo com
 * `false` onde a tela espera célula vazia passa aqui. Essa parte é do
 * `scripts/smoke-cbs-contrato.mjs`, que roda contra o banco real.
 */

/** Os nomes que cada rota tem de entregar. */
const CONTRATO: Record<string, string[]> = {
  'union-reference-rate': ['reference_date', 'valid_from', 'valid_to', 'reference_rate', 'own_rate', 'updated_at'],
  'state-reference-rate': ['state_code', 'reference_date', 'valid_from', 'valid_to', 'reference_rate', 'own_rate', 'updated_at'],
  state: ['code', 'abbreviation', 'name', 'updated_at'],
  'cst-ibscbs': ['api_record_id', 'reference_date', 'cst_code', 'description', 'valid_from', 'valid_to', 'label', 'updated_at'],
  'cst-ibscbs-indicator': [
    'cst_code',
    'group_ibscbs', 'group_ibscbs_monophasic', 'group_reduction', 'group_differential',
    'group_credit_transfer', 'group_presumed_zfm', 'group_competence_adjust',
    'allows_nfe', 'allows_nfce', 'allows_cte', 'allows_cte_os', 'allows_bpe',
    'allows_bpe_tm', 'allows_nf3e', 'allows_nfcom', 'allows_nfse',
  ],
  'cst-selective-tax': ['api_record_id', 'reference_date', 'cst_code', 'description', 'valid_from', 'valid_to', 'updated_at'],
  'tax-class-ibscbs': [
    'class_code', 'reference_date', 'description', 'rate_type', 'label',
    'tax_treatment_description', 'incompatible_with_suspension', 'requires_exemption_group',
    'has_reduction_percentage', 'credit_buyer_cbs_apportionment', 'credit_buyer_ibs_apportionment',
    'credit_presumed_supplier', 'credit_presumed_acquirer', 'prior_operation_credit',
    'valid_from', 'valid_to', 'raw_json', 'updated_at', 'cbs_reduction_percent',
    'ibs_state_reduction_percent', 'ibs_municipality_reduction_percent', 'dfe_classification_types_json',
  ],
  'tax-class-ibscbs-type': ['class_code', 'reference_date', 'acronym', 'type_code', 'description'],
  'tax-class-ibscbs-indicator': [
    'class_code', 'ibs_reduction_points', 'cbs_reduction_points', 'reduces_tax_base',
    'regular_taxation_group', 'presumed_credit_op_group', 'monophasic_standard_group',
    'monophasic_withholding_group', 'monophasic_substitution_group', 'monophasic_diff_group',
    'credit_reversal_group', 'credit_recipient_notes',
  ],
  'tax-class-selective-tax': [
    'class_code', 'reference_date', 'description', 'rate_type', 'tax_treatment_description',
    'incompatible_with_suspension', 'requires_exemption_group', 'has_reduction_percentage',
    'credit_buyer_cbs_apportionment', 'credit_buyer_ibs_apportionment',
    'credit_presumed_supplier', 'credit_presumed_acquirer', 'valid_from', 'valid_to', 'updated_at',
  ],
  'selective-tax-ncm': [
    'ncm', 'reference_date', 'subject_to_selective_tax', 'ad_valorem_rate', 'specific_rate',
    'chapter_summary', 'schedule_position', 'subitem_detail', 'valid_from', 'valid_to',
    'raw_json', 'updated_at',
  ],
  'presumed-credit-rule': [
    'rule_id', 'reference_date', 'description', 'lc214_2025_body', 'credit_via_nfe',
    'credit_via_event', 'deduct_presumed_credit', 'group_includes_cbs_presumed',
    'group_includes_ibs_presumed', 'cbs_rate', 'ibs_rate', 'presumed_credit_cbs_rate',
    'referenced_invoice_class', 'valid_from', 'valid_to', 'cbs_rate_notes', 'ibs_rate_notes',
    'presumed_cbs_rate_notes',
  ],
  'legal-basis': [
    'tax_class_code', 'reference_date', 'tax_class_description', 'tax_situation_code',
    'tax_situation_description', 'tax_subset_label', 'full_text', 'summary_text',
    'statutory_reference', 'valid_from', 'valid_to', 'raw_json', 'updated_at',
  ],
  'municipality-reference-rate': ['municipality_code', 'reference_date', 'valid_from', 'valid_to', 'reference_rate', 'updated_at'],
};

/**
 * Os nomes que o SQL entrega: o apelido do `as`, ou a própria coluna quando não há um.
 *
 * O `\bfrom\b` é deliberado. Procurar `'from'` cru corta a lista de campos dentro de
 * `valid_from` e faz o teste inventar divergência — aconteceu ao escrever esta conferência.
 * `\b` não casa depois de `_`, que é o que salva.
 */
function camposDoSql(sql: string): string[] {
  const sel = sql.slice(sql.search(/\bselect\b/i) + 6, sql.search(/\bfrom\b/i));
  const itens: string[] = [];
  let prof = 0;
  let atual = '';
  for (const ch of sel) {
    if (ch === '(') prof++;
    if (ch === ')') prof--;
    if (ch === ',' && prof === 0) {
      itens.push(atual);
      atual = '';
    } else atual += ch;
  }
  itens.push(atual);
  return itens
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((s) => (s.match(/\bas\s+"?([a-z_][a-z0-9_]*)"?$/i) ?? s.match(/([a-z_][a-z0-9_]*)$/i))?.[1] ?? s);
}

describe('rotas de CBS entregam o contrato que a tela lê', () => {
  for (const [rota, esperados] of Object.entries(CONTRATO)) {
    it(`${rota}`, () => {
      const d = CBS_CATALOG.find((x) => x.key === rota);
      expect(d, `rota "${rota}" sumiu do catálogo`).toBeDefined();
      const entregues = new Set([...camposDoSql(d!.sql), ...Object.keys(d!.constants ?? {})]);
      const faltando = esperados.filter((c) => !entregues.has(c));
      // Nome na lista = aquela coluna da tela fica vazia, sem erro nenhum aparecer.
      expect(faltando, `a tela lê estes campos e a rota não os devolve`).toEqual([]);
    });
  }

  it('municípios com alíquota (rota fora do catálogo, SQL próprio)', () => {
    const entregues = new Set(camposDoSql(CBS_MUNICIPALITY_WITH_RATE_BY_UF_SQL));
    // `code`, não `municipality_code`: a tela faz `{m.code}` na coluna Código IBGE.
    for (const c of ['code', 'name', 'state_abbreviation', 'updated_at', 'reference_rate', 'reference_date', 'valid_from', 'valid_to', 'rate_updated_at']) {
      expect(entregues.has(c), `${c} ausente`).toBe(true);
    }
  });

  it('o parser deste teste não é decorativo — ele enxerga um apelido trocado', () => {
    // Sem isto, um erro no `camposDoSql` faria TODAS as conferências acima passarem
    // vazias. Foi um "guard" que passava nos dois casos que deixou o erro anterior chegar
    // em produção; a lição é conferir a ferramenta antes de confiar nela.
    const campos = camposDoSql('select code as rule_code, validity_start as valid_from from t');
    expect(campos).toEqual(['rule_code', 'valid_from']);
    expect(campos).not.toContain('rule_id');
  });
});
