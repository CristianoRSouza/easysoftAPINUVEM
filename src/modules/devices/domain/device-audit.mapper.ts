import { toIso } from '../../../common/mapping/coerce';
import type { Row } from '../../../db/queryable';

/** Teto de linhas de auditoria por resposta — histórico cresce sem parar. */
export const MAX_AUDIT = 500;

/** Quantas linhas a auditoria unificada devolve: o pedido, com default 100 e o teto acima. */
export const limiteDeAuditoria = (limit: number): number =>
  Math.min(limit > 0 ? limit : 100, MAX_AUDIT);

const isObject = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * Auditoria. Os três campos estruturados (`changed_fields`, `previous_values`,
 * `new_values`) viram lista/objeto vazio quando nulos — a tela itera sobre eles, e `null`
 * viraria "não foi possível carregar" em vez de "nada mudou aqui".
 */
export function mapAudit(r: Row) {
  return {
    id: String(r.id),
    ...(r.agent_config_id != null ? { agent_config_id: String(r.agent_config_id) } : {}),
    ...(r.totem_config_id != null ? { totem_config_id: String(r.totem_config_id) } : {}),
    action: String(r.action ?? ''),
    changed_fields: Array.isArray(r.changed_fields) ? r.changed_fields.map(String) : [],
    previous_values: isObject(r.previous_values) ? r.previous_values : {},
    new_values: isObject(r.new_values) ? r.new_values : {},
    // 'admin' é o default de quando a alteração veio de um caminho sem usuário atribuído.
    performed_by: r.performed_by != null ? String(r.performed_by) : 'admin',
    created_at: toIso(r.created_at),
  };
}

/** Linha da auditoria unificada: a de cima, mais de onde veio e de quem é. */
export function mapUnifiedAudit(r: Row) {
  return {
    ...mapAudit(r),
    source: String(r.source),
    entity_id: String(r.entity_id),
    entity_name: String(r.entity_name ?? ''),
  };
}
