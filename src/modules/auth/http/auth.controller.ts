import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public, SkipTenant } from '../../../common/decorators';
import { UserId } from '../../../common/http/request.decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { sessionCookieOptions } from '../../../common/session-cookie';
import { ENV, type Env } from '../../../config/env';
import { AuthService } from '../application/auth.service';
import { PasswordRecoveryService } from '../application/password-recovery.service';
import { derivedSessionSchema, type DerivedSessionInput } from '../dto/derived-session.schema';
import { loginSchema, type LoginInput } from '../dto/login.schema';
import { recoverySchema, type RecoveryInput } from '../dto/recovery.schema';
import {
  DocDerivedSession,
  DocLogin,
  DocLogout,
  DocMe,
  DocRecoveryEmail,
  DocSsoSupport,
} from './auth.docs';

@ApiTags('Auth')
// Rotas de IDENTIDADE operam no contexto do usuário, não de uma empresa: login/logout/me,
// sessão derivada e SSO valem independentemente de qual empresa está selecionada na tela.
@SkipTenant()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly recovery: PasswordRecoveryService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Login público: valida a senha e devolve a sessão num cookie httpOnly. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @Post('login')
  @HttpCode(200)
  @DocLogin()
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, expiresAt, user } = await this.service.login(body.email, body.password);
    res.cookie(this.env.SESSION_COOKIE_NAME, token, sessionCookieOptions(this.env, expiresAt));
    return { user };
  }

  /** Logout público (revoga a sessão e limpa o cookie mesmo se já expirada). */
  @Public()
  @Post('logout')
  @HttpCode(200)
  @DocLogout()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token =
      (req as Request & { cookies?: Record<string, string> }).cookies?.[this.env.SESSION_COOKIE_NAME] ||
      String(req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
    if (token) await this.service.logout(token);
    res.clearCookie(this.env.SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  /** Quem sou eu (exige sessão — o AuthGuard já populou req.user). */
  @Get('me')
  @DocMe()
  async me(@UserId() userId: string) {
    return this.service.me(userId);
  }

  /** Sessão derivada (migra a edge function mint-derived-session). Exige sessão. */
  @Post('derived-session')
  @HttpCode(200)
  @DocDerivedSession()
  async derivedSession(
    @Body(new ZodValidationPipe(derivedSessionSchema)) body: DerivedSessionInput,
    @UserId() userId: string,
  ) {
    return this.service.mintDerivedSession(userId, body?.redirect_to);
  }

  /** Token SSO pro projeto Support (migra sso-support). Exige sessão. */
  @Post('sso/support')
  @HttpCode(200)
  @DocSsoSupport()
  async ssoSupport(@UserId() userId: string) {
    return this.service.ssoSupport(userId);
  }

  /** Recuperação de senha (migra send-recovery-email). PÚBLICA; 200 constante (privacidade). */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @Post('recovery-email')
  @DocRecoveryEmail()
  async recoveryEmail(
    @Body(new ZodValidationPipe(recoverySchema)) body: RecoveryInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { status, body: out } = await this.recovery.sendRecoveryEmail(body);
    res.status(status);
    return out;
  }
}
