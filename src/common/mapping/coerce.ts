/**
 * Conversões de linha do banco para o FIO (ver `src/contract/README.md`).
 *
 * O driver `pg` entrega `numeric`/`int8` como string e `timestamptz` como `Date`; o
 * contrato pede `number` e string ISO. Estas funções são essa tradução, escritas uma vez.
 *
 * ⚠️ Os nomes dizem o que acontece com AUSÊNCIA, e é aí que elas diferem:
 *   • `str` / `toIso` / `toInt` / `toFloat` → ausência vira valor neutro ('' ou 0);
 *   • `nullable*`                            → ausência continua `null`;
 *   • `blankToNull`                          → string vazia TAMBÉM vira `null`.
 * Trocar uma pela outra muda o JSON que a tela recebe. Ao trocar um helper local por um
 * destes, confira que o comportamento é o mesmo — nome parecido não basta.
 */

export const str = (v: unknown): string => (v == null ? '' : String(v));

export const nullableStr = (v: unknown): string | null => (v == null ? null : String(v));

/** String vazia (ou só espaços) é ausência de dado, não valor. */
export function blankToNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.trim() === '' ? null : s;
}

export function toInt(v: unknown): number {
  const n = parseInt(String(v ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

export function toFloat(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

/** Distingue "não veio" de "veio zero" — `fb_sale_id: 0` é um id, `null` é ausência. */
export function nullableNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toIso(v: unknown): string {
  if (v == null) return '';
  return v instanceof Date ? v.toISOString() : String(v);
}

export function nullableIso(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}
