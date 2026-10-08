import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as crypto from 'crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { DEFAULT_SESSION_COOKIE_NAME } from '../session-cookie';

/** O pouco da requisição que a chave de contagem lê — este guard roda antes de tudo. */
type RequisicaoRastreavel = {
  headers?: IncomingHttpHeaders;
  cookies?: Record<string, string | undefined>;
};

/**
 * Rate-limit contado por SESSÃO, não por IP.
 *
 * Por que trocar: o limite por IP quebra no uso real da SPA. Numa empresa, todos os
 * usuários saem pelo mesmo IP (NAT do escritório) e dividem a mesma cota; uma tela de
 * dashboard dispara dezenas de chamadas em paralelo. O primeiro a abrir o painel
 * derrubaria os colegas com 429 — sem que ninguém tenha abusado de nada.
 *
 * Chave de contagem, em ordem:
 *   1. Sessão de usuário (cookie httpOnly ou Bearer opaco) → `s:<sha256(token)>`
 *   2. Chamada máquina-a-máquina (X-Service-Key)          → `k:<sha256(key)>`
 *   3. Anônimo                                            → IP (comportamento do pai)
 *
 * ⚠️ Este guard roda ANTES do AuthGuard (é essa a ordem em `app.module.ts`), então
 * `req.user` ainda não existe: a chave sai do token CRU, sem validá-lo. Isso é
 * proposital e seguro — o valor só serve de chave de contagem, nunca de credencial.
 * Token inválido apenas conta na sua própria cota e morre no 401 do AuthGuard logo
 * depois. O hash existe para não jogar segredo em memória/log de métrica.
 *
 * Consequência desejada: as rotas anônimas continuam limitadas por IP. `POST /auth/login`
 * e `POST /auth/recovery-email` (10/min via `@Throttle`) seguem contando por IP, que é
 * exatamente o que se quer contra força bruta — quem ainda não tem sessão não escapa
 * do limite compartilhado.
 */
@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: RequisicaoRastreavel): Promise<string> {
    // `process.env` direto, e não o `Env` injetado: este guard roda ANTES do AuthGuard e
    // só precisa do NOME do cookie para montar a chave de contagem. O default vem da
    // constante compartilhada — o mesmo valor que o `env.ts` usa —, para os dois não
    // divergirem em silêncio.
    const cookieName = process.env.SESSION_COOKIE_NAME || DEFAULT_SESSION_COOKIE_NAME;
    const bearer = String(req.headers?.['authorization'] ?? '').replace(/^Bearer\s+/i, '');
    const sessionToken = req.cookies?.[cookieName] || bearer;
    if (sessionToken) return `s:${sha256(sessionToken)}`;

    const serviceKey = req.headers?.['x-service-key'];
    if (typeof serviceKey === 'string' && serviceKey) return `k:${sha256(serviceKey)}`;

    return super.getTracker(req);
  }
}

function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}
