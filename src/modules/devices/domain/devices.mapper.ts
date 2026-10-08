import type { Row } from '../../../db/queryable';

/** Datas viram ISO; o resto passa como está (a config do agente é toda escalar). */
export function normalizeRow(r: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

/** Totem na forma do fio: a linha normalizada mais o `plan_name` derivado da licença. */
export function mapTotem(r: Row): Record<string, unknown> {
  const out = normalizeRow(r);
  // `plan_name` só existe quando o tipo NÃO é um dos genéricos — a tela mostra o
  // nome do plano quando há um, e o rótulo do tipo quando não há.
  const lt = r.license_type != null ? String(r.license_type) : null;
  out.plan_name = lt && !/^(monthly|yearly|trial)$/i.test(lt) ? lt : null;
  return out;
}

/**
 * Credenciais do PIXnoPDV como a tela as lê. Os segredos já chegam redigidos do banco
 * (`*_set`) — ver `infrastructure/pixnopdv.sql.ts`.
 */
export function mapPixnopdvCredentials(r: Row) {
  return {
    store_id: String(r.store_id),
    environment: String(r.environment ?? 'producao'),
    api_base_url: r.api_base_url != null ? String(r.api_base_url) : null,
    basic_user: r.basic_user != null ? String(r.basic_user) : null,
    insecure_tls: Boolean(r.insecure_tls),
    enabled: Boolean(r.enabled),
    basic_token_set: r.basic_token_set === true,
    secret_key_set: r.secret_key_set === true,
    // Não é `nullableIso`: o que não for `Date` passa COMO VEIO, sem virar string.
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : (r.updated_at ?? null),
  };
}

/** `[{ id, image_url }]` → `{ id: url }`, que é como a tela de Comandas consulta. */
export const mapProductImages = (
  rows: Array<{ id: string; image_url: string }>,
): Record<string, string> =>
  Object.fromEntries(rows.map((r) => [String(r.id), String(r.image_url)]));
