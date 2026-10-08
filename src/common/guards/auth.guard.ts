import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as crypto from 'crypto';
import { ENV, type Env } from '../../config/env';
import { IS_PUBLIC, IS_SERVICE_ONLY } from '../decorators';
import { SessionService } from '../../db/session.service';
import { sessionCookieOptions } from '../session-cookie';

/**
 * Guard único com ramos ordenados (EasyML §2):
 *   @Public → libera
 *   @ServiceOnly → exige X-Service-Key (máquina-a-máquina, ex.: provision-tenant)
 *   default → exige sessão de usuário (cookie httpOnly ou Bearer opaco)
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const has = (key: string) =>
      this.reflector.getAllAndOverride<boolean>(key, [ctx.getHandler(), ctx.getClass()]);

    if (has(IS_PUBLIC)) return true;

    const req = ctx.switchToHttp().getRequest();

    if (has(IS_SERVICE_ONLY)) {
      const provided =
        (req.headers['x-service-key'] as string) ||
        String(req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
      if (!provided || !timingSafeEqual(provided, this.env.SERVICE_API_KEY)) {
        throw new UnauthorizedException({ error: 'unauthorized', message: 'X-Service-Key ausente ou inválida.' });
      }
      return true;
    }

    // Sessão de usuário (browser): cookie httpOnly ou Bearer opaco.
    const fromCookie = req.cookies?.[this.env.SESSION_COOKIE_NAME] as string | undefined;
    const token = fromCookie || String(req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException({ error: 'unauthorized', message: 'Sessão ausente. Faça login.' });
    }
    const { userId, renewedExpiresAt } = await this.sessions.validate(token); // lança 401 ou 503
    req.user = { id: userId };
    // Sliding-expiry: renovou e veio do cookie → reemite o cookie com validade fresca.
    if (renewedExpiresAt && fromCookie) {
      const res = ctx.switchToHttp().getResponse();
      res.cookie(this.env.SESSION_COOKIE_NAME, token, sessionCookieOptions(this.env, renewedExpiresAt));
    }
    return true;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
