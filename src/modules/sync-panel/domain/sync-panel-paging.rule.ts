import { SYNC_PANEL_MAX_LIMIT, type SyncPanelRoute } from './sync-panel.catalog';

/**
 * `limit`/`offset` do painel: da query string até o número que vai para a RPC. Puro.
 *
 * A regra é tolerante de propósito — valor que não serve vira o padrão, nunca um 400: é
 * um painel de monitoramento, e uma URL mal montada deve mostrar a fila, não um erro.
 */

/**
 * Inteiro opcional vindo da query string. Ausente, vazio ou não numérico → `undefined`.
 *
 * É o `parseInt` de sempre, com as tolerâncias dele: `"12abc"` vale 12 e `"1.9"` vale 1.
 * Parâmetro repetido (`?limit=1&limit=2`) chega como lista e vale o primeiro.
 */
export function parseOptionalInt(raw: unknown): number | undefined {
  if (raw == null || String(raw).trim() === '') return undefined;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Sem limite útil (ausente, zero, negativo) vale o padrão da rota; o teto vale sempre. */
export function resolveLimit(
  route: Pick<SyncPanelRoute, 'defaultLimit'>,
  limit: number | undefined,
): number {
  return Math.min(limit && limit > 0 ? limit : (route.defaultLimit ?? 50), SYNC_PANEL_MAX_LIMIT);
}

/** Offset ausente ou negativo é o começo da lista. */
export const resolveOffset = (offset: number | undefined): number =>
  offset && offset > 0 ? offset : 0;
