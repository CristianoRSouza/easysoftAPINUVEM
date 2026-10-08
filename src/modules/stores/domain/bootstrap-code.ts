import * as crypto from 'crypto';

/**
 * O "código de primeiro acesso" que a Admin-API local verifica OFFLINE.
 * FORMATO IMUTÁVEL (contrato byte-a-byte):
 *   token = "EFB1.<b64url(json)>.<b64url(hmacSha256)>"
 *   key   = HKDF-SHA256(ikm=master, salt=vazio, info="easyfood/bootstrap-code/v1", 32B)
 *   payload = { v:1, em, sid, exp, jti }
 *
 * Funções puras: a mesma entrada dá o mesmo código. Quem sorteia o `jti`, lê o relógio e
 * confere a chave-mestra é o `StoresService`.
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DEFAULT_TTL_HOURS = 48;
export const MAX_TTL_HOURS = 72;
const HKDF_INFO = 'easyfood/bootstrap-code/v1';
const TOKEN_PREFIX = 'EFB1';

/** A ordem das chaves é a do JSON assinado — não reordene. */
export interface BootstrapCodePayload {
  v: 1;
  em: string;
  sid: string;
  exp: number;
  jti: string;
}

/** Ausente, zero, negativo ou não-numérico cai no default; acima do teto é reduzido em silêncio. */
export function resolveTtlHours(raw: unknown): number {
  let ttlHours = Number(raw);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) ttlHours = DEFAULT_TTL_HOURS;
  return Math.min(ttlHours, MAX_TTL_HOURS);
}

/** `exp` em segundos Unix. Hora fracionária vale: o arredondamento é para baixo, no segundo. */
export function expiresAtSeconds(nowSec: number, ttlHours: number): number {
  return nowSec + Math.floor(ttlHours * 3600);
}

/** Assina com a chave DERIVADA da master (32 bytes). O que entra no HMAC inclui o prefixo. */
export function signBootstrapCode(payload: BootstrapCodePayload, master: Buffer): string {
  const derived = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(HKDF_INFO), 32));
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${TOKEN_PREFIX}.${encoded}`;
  const sig = crypto.createHmac('sha256', derived).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}
