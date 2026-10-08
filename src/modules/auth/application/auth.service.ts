import { Inject, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ENV, type Env } from '../../../config/env';
import { ServiceRole } from '../../../db/service-role';
import { SessionService } from '../../../db/session.service';
import { signSsoSupportToken, ssoDisplayName, ssoRedirectUrl } from '../domain/sso-token';
import { SupabaseAuthClient } from '../infrastructure/supabase-auth.client';

/**
 * A API é o servidor de auth (EasyML §2): valida a senha server-side contra o
 * Supabase Auth (onde os usuários vivem) e emite um TOKEN OPACO próprio. O browser
 * nunca recebe o JWT do Supabase.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly authClient: SupabaseAuthClient,
    private readonly serviceRole: ServiceRole,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(email: string, password: string) {
    const user = await this.authClient.signInWithPassword(email, password);
    if (!user) {
      // genérico de propósito — não revela se o e-mail existe.
      throw new UnauthorizedException({ error: 'invalid_credentials', message: 'E-mail ou senha inválidos.' });
    }
    const { token, expiresAt } = await this.serviceRole.run('auth-session', () => this.sessions.create(user.id));
    return { token, expiresAt, user: { id: user.id, email: user.email ?? email } };
  }

  async me(userId: string) {
    const user = await this.authClient.findUser(userId);
    return { id: userId, email: user?.email ?? null };
  }

  async logout(token: string) {
    await this.sessions.revoke(token);
  }

  /**
   * Emite um token_hash de magiclink (Auth admin) para o próprio usuário logado —
   * um app derivado consome via verifyOtp. Migração da edge function
   * mint-derived-session: a SESSÃO da API (não um Bearer JWT) identifica o caller;
   * o generateLink roda pelo chokepoint (service_role).
   */
  async mintDerivedSession(userId: string, redirectTo?: string) {
    const email = (await this.authClient.findUser(userId))?.email;
    if (!email) throw new UnauthorizedException({ error: 'unauthorized', message: 'Usuário sem e-mail.' });

    const tokenHash = await this.authClient.generateMagicLinkHash(email, redirectTo);
    if (!tokenHash) {
      throw new InternalServerErrorException({ error: 'mint_failed', message: 'Falha ao emitir a sessão derivada.' });
    }
    return { email, token_hash: tokenHash, type: 'magiclink' as const, expires_in: 3600 };
  }

  /**
   * Emite um token assinado (HMAC-SHA256) com e-mail/nome do usuário logado, para
   * o projeto Support auto-logar. Migração de sso-support. FORMATO IMUTÁVEL
   * (contrato com o Support): `base64url(json).base64url(hmac)`, `iss:'easycommandpay'`.
   *
   * Chave: `SSO_SHARED_SECRET_EASYFOOD` (dedicada) na frente, `SSO_SHARED_SECRET`
   * (legada, compartilhada com os outros módulos Easy*) como ponte. Trocar a ordem
   * ou remover a ponte antes de o receptor publicar a chave dedicada derruba o botão.
   */
  async ssoSupport(userId: string) {
    const secret = this.env.SSO_SHARED_SECRET_EASYFOOD || this.env.SSO_SHARED_SECRET;
    if (!secret) {
      throw new InternalServerErrorException({
        error: 'sso_not_configured',
        message: 'SSO_SHARED_SECRET_EASYFOOD/SSO_SHARED_SECRET ausentes.',
      });
    }
    const user = await this.authClient.findUser(userId);
    const email = user?.email;
    if (!email) throw new UnauthorizedException({ error: 'unauthorized', message: 'Usuário sem e-mail.' });

    const name = ssoDisplayName(user.meta ?? {}, email);
    const nowSec = Math.floor(Date.now() / 1000);
    const token = signSsoSupportToken({ email, name, userId }, nowSec, secret);
    return { token, redirect_url: ssoRedirectUrl(this.env.SUPPORT_SSO_ENDPOINT, token) };
  }
}
