import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { DbService } from './db.service';
import { ENV, type Env } from '../config/env';

interface CacheEntry {
  userId: string;
  expiresAtMs: number;
  cachedAtMs: number;
}

/**
 * Sessões opacas revogáveis (EasyML §2). A API emite um token aleatório e guarda
 * no banco só o `sha256(token)` — nunca o token. Inclui:
 *  - cache em memória (dispensa o banco por alguns segundos);
 *  - sliding-expiry com throttle (renova a validade sem gerar token novo);
 *  - discriminador barato (token opaco não tem ponto — se tiver, é JWT, nega sem ir ao banco);
 *  - fail-closed: erro de banco = 503, NUNCA 401.
 */
@Injectable()
export class SessionService {
  private readonly ttlMs: number;
  private readonly throttleMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly db: DbService,
    @Inject(ENV) env: Env,
  ) {
    this.ttlMs = env.SESSION_TTL_HOURS * 3_600_000;
    this.throttleMs = env.SESSION_RENEW_THROTTLE_MINUTES * 60_000;
    this.cacheTtlMs = env.SESSION_CACHE_SECONDS * 1_000;
  }

  private hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /** Cria uma sessão para o usuário e devolve o token (em claro, só desta vez). */
  async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);
    const hash = this.hash(token);
    await this.db.query('insert into hub_sessions (user_id, token_hash, expires_at) values ($1, $2, $3)', [
      userId,
      hash,
      expiresAt.toISOString(),
    ]);
    this.cache.set(hash, { userId, expiresAtMs: expiresAt.getTime(), cachedAtMs: Date.now() });
    return { token, expiresAt };
  }

  /**
   * Valida o token. Retorna o userId e, se a sessão foi renovada (sliding-expiry),
   * a nova validade — pro guard reemitir o cookie. 401 = inválida/expirada; 503 = erro de banco.
   */
  async validate(token: string): Promise<{ userId: string; renewedExpiresAt?: Date }> {
    // Discriminador barato: token opaco (base64url) nunca tem ponto; JWT tem.
    if (!token || token.includes('.')) throw unauthorized();

    const hash = this.hash(token);
    const now = Date.now();

    // Cache: hit fresco e não expirado dispensa o banco.
    const cached = this.cache.get(hash);
    if (cached && now - cached.cachedAtMs < this.cacheTtlMs && cached.expiresAtMs > now) {
      return { userId: cached.userId };
    }

    let rows: Array<{ user_id: string; expires_at: string }>;
    try {
      rows = (
        await this.db.query<{ user_id: string; expires_at: string }>(
          'select user_id, expires_at from hub_sessions where token_hash = $1',
          [hash],
        )
      ).rows;
    } catch {
      // fail-closed: um blip do banco não pode deslogar a frota inteira (§2).
      throw new HttpException(
        { error: 'service_unavailable', message: 'Falha ao validar a sessão. Tente de novo.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const s = rows[0];
    const expiresAtMs = s ? new Date(s.expires_at).getTime() : 0;
    if (!s || expiresAtMs < now) {
      this.cache.delete(hash);
      throw unauthorized();
    }

    // Sliding-expiry com throttle: só renova quando a vida restante < (TTL − throttle).
    let renewedExpiresAt: Date | undefined;
    let finalExpiresMs = expiresAtMs;
    if (expiresAtMs - now < this.ttlMs - this.throttleMs) {
      renewedExpiresAt = new Date(now + this.ttlMs);
      finalExpiresMs = renewedExpiresAt.getTime();
      await this.db.query('update hub_sessions set expires_at = $2, last_seen_at = now() where token_hash = $1', [
        hash,
        renewedExpiresAt.toISOString(),
      ]);
    }

    this.cache.set(hash, { userId: s.user_id, expiresAtMs: finalExpiresMs, cachedAtMs: now });
    return { userId: s.user_id, renewedExpiresAt };
  }

  async revoke(token: string): Promise<void> {
    const hash = this.hash(token);
    this.cache.delete(hash);
    await this.db.query('delete from hub_sessions where token_hash = $1', [hash]).catch(() => undefined);
  }
}

function unauthorized(): HttpException {
  return new HttpException(
    { error: 'unauthorized', message: 'Sessão inválida ou expirada.' },
    HttpStatus.UNAUTHORIZED,
  );
}
