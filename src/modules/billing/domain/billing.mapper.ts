import { nullableStr, str, toFloat, toIso } from '../../../common/mapping/coerce';
import type {
  CreditTransaction,
  ModulePlan,
  PlanHistoryWindow,
  UsageLogEntry,
} from '../../../contract/billing.schema';
import type { Row } from '../../../db/queryable';

/**
 * Linha de `billing.*` → forma do fio. Funções puras: não consultam, não lançam, não
 * dependem do Nest. O que cada campo vira quando está AUSENTE é decisão de contrato.
 */

export function mapCreditTransaction(r: Row): CreditTransaction {
  return {
    id: String(r.id),
    credit_type: str(r.credit_type),
    type: str(r.type),
    // `numeric` chega como STRING (typeParser do pool, para casar com o PostgREST).
    // O saldo é somado na tela, então tem que sair daqui como número.
    amount: toFloat(r.amount),
    description: nullableStr(r.description),
    reference_id: nullableStr(r.reference_id),
    created_by: nullableStr(r.created_by),
    // `timestamptz` chega como Date (não há typeParser para ele); o fio é sempre ISO.
    created_at: toIso(r.created_at),
  };
}

export function mapUsageLogEntry(r: Row): UsageLogEntry {
  return {
    id: String(r.id),
    user_id: str(r.user_id),
    service_type: str(r.service_type),
    module: str(r.module),
    function_name: str(r.function_name),
    action: nullableStr(r.action),
    model_used: nullableStr(r.model_used),
    tokens_input: toFloat(r.tokens_input),
    tokens_output: toFloat(r.tokens_output),
    tokens_total: toFloat(r.tokens_total),
    credits_consumed: toFloat(r.credits_consumed),
    was_free: Boolean(r.was_free),
    input_summary: nullableStr(r.input_summary),
    output_summary: nullableStr(r.output_summary),
    status: str(r.status),
    error_message: nullableStr(r.error_message),
    duration_ms: r.duration_ms != null ? toFloat(r.duration_ms) : null,
    created_at: toIso(r.created_at),
    app_source: nullableStr(r.app_source),
    platform_display_name: nullableStr(r.platform_display_name),
  };
}

/**
 * Sem plano, ou plano sem janela cadastrada → `historyWindowDays: null` (sem restrição):
 * zero significaria "não pode ver nada", o oposto de "não cadastrado".
 */
export function mapPlanHistoryWindow(row: Row | undefined): PlanHistoryWindow {
  const planSlug = row?.plan_name != null ? String(row.plan_name) : null;
  if (!row || !planSlug) return { planSlug: null, planName: null, historyWindowDays: null };

  return {
    planSlug,
    planName: row.plan_display_name != null ? String(row.plan_display_name) : null,
    historyWindowDays: row.history_window_days != null ? toFloat(row.history_window_days) : null,
  };
}

export function mapModulePlan(r: Row): ModulePlan {
  return {
    slug: str(r.slug),
    module: str(r.module),
    name: str(r.name),
    tier: nullableStr(r.tier),
    price_brl: r.price_brl != null ? toFloat(r.price_brl) : null,
    history_window_days: r.history_window_days != null ? toFloat(r.history_window_days) : null,
    is_mock: r.is_mock != null ? Boolean(r.is_mock) : null,
    coming_soon: r.coming_soon != null ? Boolean(r.coming_soon) : null,
    max_users: r.max_users != null ? toFloat(r.max_users) : null,
    sort_order: r.sort_order != null ? toFloat(r.sort_order) : null,
    // `features` é jsonb: já chega como array. Blindado porque um cadastro torto
    // (objeto, string) faria a tela quebrar num `.map`.
    features: Array.isArray(r.features) ? r.features.map((f: unknown) => String(f)) : [],
  };
}
