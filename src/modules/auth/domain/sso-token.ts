import * as crypto from 'crypto';

/**
 * Token SSO para o projeto Support auto-logar. FORMATO IMUTÁVEL (contrato com o Support):
 * `base64url(json).base64url(hmac)`, `iss:'easycommandpay'`, validade de 120 segundos.
 *
 * Funções puras: quem lê o relógio e escolhe a chave é o `AuthService`.
 */

const SSO_ISSUER = 'easycommandpay';
const SSO_TTL_SECONDS = 120;

/** Nome exibido no Support: metadado do Auth, senão o que vem antes do `@`. */
export function ssoDisplayName(meta: Record<string, unknown>, email: string): string {
  return (meta.full_name as string) || (meta.name as string) || email.split('@')[0] || 'Usuário';
}

export interface SsoIdentity {
  email: string;
  name: string;
  userId: string;
}

/** A ordem das chaves do payload é a do JSON assinado — não reordene. */
export function signSsoSupportToken(identity: SsoIdentity, nowSec: number, secret: string): string {
  const payload = {
    email: identity.email,
    name: identity.name,
    source_user_id: identity.userId,
    iat: nowSec,
    exp: nowSec + SSO_TTL_SECONDS,
    iss: SSO_ISSUER,
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadStr).digest('base64url');
  return `${payloadStr}.${signature}`;
}

/** URL pronta para o browser: o token vai URL-encoded na query. */
export const ssoRedirectUrl = (endpoint: string, token: string): string =>
  `${endpoint}?token=${encodeURIComponent(token)}`;
