import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * CORS: NUNCA refletir qualquer origem COM credenciais (evita account-takeover cross-site).
 * Com allowlist explícita → credenciais liberadas só p/ ela. Com '*' → sem credenciais (cookies).
 *
 * Função pura sobre o valor de `CORS_ORIGIN` (lista separada por vírgula), para a regra
 * poder ser testada sem subir a aplicação.
 */
export function resolveCors(corsOrigin: string): { options: CorsOptions; wildcard: boolean } {
  const origins = corsOrigin
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const wildcard = origins.length === 0 || origins.includes('*');
  return {
    wildcard,
    options: { origin: wildcard ? true : origins, credentials: !wildcard },
  };
}
