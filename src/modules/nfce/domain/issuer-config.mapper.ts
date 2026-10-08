import type { Row } from '../../../db/queryable';

/**
 * Campos que a tela espera existir mas que **nunca** viajam com valor.
 *
 * Não é lista de pendências: é a decisão de que segredo de emitente não sai do servidor.
 * A senha do certificado e os tokens TEF são cifrados/usados pelo serviço da loja, não
 * pela tela. O par `*_set` diz se estão configurados, que é tudo que a tela precisa para
 * mostrar "pendente" ou "pronto".
 */
export const ISSUER_NULL_SECRETS = [
  'certificate_password',
  'aditum_tef_partner_token',
  'aditum_tef_activation_code',
  'tef_admin_http_api_key',
] as const;

/**
 * Linha de `infrastructure/issuer-config.sql.ts` → o objeto que a tela do Emitente lê.
 * As colunas passam como vieram (o rename já foi feito no SQL); só data vira ISO.
 */
export function mapIssuerConfig(r: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) out[k] = v instanceof Date ? v.toISOString() : v;
  // Segredos que a tela espera existir mas que nunca viajam com valor.
  for (const k of ISSUER_NULL_SECRETS) out[k] = null;
  // A tela mostra "prefixo••••••••" — o valor completo nunca existiu em claro no banco.
  out.apikey_easyerp = r.api_key_prefix ? `${r.api_key_prefix}••••••••` : null;
  return out;
}
