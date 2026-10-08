/**
 * `limit`/`stateCode` das tabelas de referência: da query string ao que vai para a
 * consulta. Puro.
 */

/** Teto absoluto por resposta — nem um `limit` grande na query string fura. */
export const MAX_ROWS = 2000;

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

/** Sem limite útil (ausente, zero, negativo) vale o padrão da tabela; o teto vale sempre. */
export const rowCap = (limit: number | undefined, defaultLimit: number): number =>
  Math.min(limit && limit > 0 ? limit : defaultLimit, MAX_ROWS);
