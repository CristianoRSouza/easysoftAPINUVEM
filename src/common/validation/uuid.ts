/** UUID v1–v5, variante RFC 4122. A mesma régua para header de tenant e parâmetro de rota. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (valor: unknown): valor is string =>
  typeof valor === 'string' && UUID_RE.test(valor);
