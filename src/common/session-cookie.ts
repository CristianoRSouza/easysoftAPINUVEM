import type { CookieOptions } from 'express';
import type { Env } from '../config/env';

/**
 * Nome do cookie de sessão quando `SESSION_COOKIE_NAME` não vem do ambiente.
 *
 * Mora AQUI, e não no `env.ts`, porque quem precisa dele fora do env validado é o
 * `SessionThrottlerGuard`: ele roda antes da autenticação e lê o token cru de
 * `process.env`, sem o objeto `Env` injetado. O literal chegou a estar escrito em três
 * lugares (`env.ts`, `swagger.ts` e o guard); os três concordavam, mas nada garantia que
 * continuassem concordando — e uma divergência aqui é silenciosa: o rate-limit passaria a
 * procurar um cookie que não existe e cairia no IP sem avisar ninguém.
 *
 * O import deste arquivo pelo `env.ts` não cria ciclo em runtime: o que vem na direção
 * contrária é só `import type { Env }`, que o TypeScript apaga na compilação.
 */
export const DEFAULT_SESSION_COOKIE_NAME = 'easyfood_session';

/**
 * Opções do cookie de sessão — um lugar só (login e renovação usam as mesmas),
 * no espírito do `hub-cookie.ts` do EasyML.
 * SameSite vem do env: 'lax' (mesma origem) ou 'none' (SPA/API em origens diferentes).
 * SameSite=None SÓ funciona com Secure (HTTPS) — por isso forçamos secure nesse caso.
 */
export function sessionCookieOptions(env: Env, expires: Date): CookieOptions {
  const sameSite = env.SESSION_COOKIE_SAMESITE;
  return {
    httpOnly: true,
    sameSite,
    secure: env.NODE_ENV === 'production' || sameSite === 'none',
    expires,
    path: '/',
  };
}
