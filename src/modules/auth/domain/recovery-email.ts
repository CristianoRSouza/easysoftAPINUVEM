const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * E-mail do pedido de recuperação, aparado e em minúsculas — ou `null` se o FORMATO não
 * serve. É checagem de forma, não de existência: não diz nada sobre haver conta.
 */
export function normalizeRecoveryEmail(raw: string | undefined): string | null {
  const email = (raw || '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return null;
  return email;
}
