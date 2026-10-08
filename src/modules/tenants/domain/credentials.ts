import * as crypto from 'crypto';

// ---- helpers (crypto no serviço; o texto puro nunca toca o banco) ----

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Sorteio sem viés de módulo: descarta os bytes que cairiam no resto de 256 / n. */
function randomFromAlphabet(alphabet: string, length: number): string {
  const n = alphabet.length;
  const maxUnbiased = Math.floor(256 / n) * n;
  const out: string[] = [];
  while (out.length < length) {
    const bytes = crypto.randomBytes(length - out.length);
    for (const b of bytes) {
      if (b < maxUnbiased) {
        out.push(alphabet[b % n]);
        if (out.length === length) break;
      }
    }
  }
  return out.join('');
}

export function generateApiKey(): string {
  return 'sk_live_' + randomFromAlphabet(ALPHABET, 32);
}

export function generatePassword(): string {
  return randomFromAlphabet(ALPHABET + '!@#$%', 16);
}

export function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** O que o banco guarda de uma chave: o hash e os 8 primeiros caracteres, nunca o texto. */
export function apiKeyFingerprint(key: string): { apiKeyHash: string; apiKeyPrefix: string } {
  return { apiKeyHash: sha256hex(key), apiKeyPrefix: key.slice(0, 8) };
}
