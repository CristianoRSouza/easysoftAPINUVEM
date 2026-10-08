import type { Row } from '../../../db/queryable';

/** Datas viram ISO; o resto passa como está (as RPCs já devolvem tipos simples). */
export function mapPanelRow(row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}
