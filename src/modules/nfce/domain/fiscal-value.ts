/** Valor FISCAL viaja como string — arredondar em float aqui é problema com a Receita. */
export const numStr = (v: unknown): string => (v == null ? '0' : String(v));
