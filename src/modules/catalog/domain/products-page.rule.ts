/** Teto de página — sem ele, um `to` grande vira SELECT sem limite prático. */
export const MAX_PAGE_SIZE = 500;

/** Janela de página já resolvida: quantas linhas pedir e a partir de qual. */
export interface PageWindow {
  limit: number;
  offset: number;
}

/**
 * `from`/`to` são índices INCLUSIVOS (herança do `range()` do PostgREST): 0..49 pede 50
 * linhas. `to` menor que `from` vira uma linha só — nunca um `limit` negativo — e a
 * página nunca passa de `MAX_PAGE_SIZE`.
 */
export function pageWindow(q: { from: number; to: number }): PageWindow {
  const from = q.from;
  const to = Math.max(from, q.to);
  return { limit: Math.min(to - from + 1, MAX_PAGE_SIZE), offset: from };
}
