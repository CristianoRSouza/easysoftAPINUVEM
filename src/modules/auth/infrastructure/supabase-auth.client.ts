import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../../config/env';
import { ServiceRole } from '../../../db/service-role';
import { SupabaseAdmin } from '../../../db/supabase-admin';

export interface AuthUser {
  email: string | null;
  meta: Record<string, unknown>;
}

/**
 * Tudo o que este módulo fala com o Supabase Auth (GoTrue), onde os usuários vivem.
 *
 * Dois caminhos, e a diferença importa: a conferência de SENHA usa o endpoint público de
 * token (como qualquer cliente faria); o resto é Auth ADMIN, com a `service_role`, sempre
 * pelo chokepoint `auth-admin`. Nada aqui lança erro de regra: devolve `null` e o service
 * decide o que responder.
 */
@Injectable()
export class SupabaseAuthClient {
  constructor(
    private readonly serviceRole: ServiceRole,
    private readonly supa: SupabaseAdmin,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Confere e-mail/senha. `null` = credencial recusada (ou resposta sem usuário). */
  async signInWithPassword(email: string, password: string): Promise<{ id: string; email?: string } | null> {
    const apikey = this.env.SUPABASE_ANON_KEY || this.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(`${this.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey, Authorization: `Bearer ${apikey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { id?: string; email?: string } };
    if (!data.user?.id) return null;
    return { id: data.user.id, email: data.user.email };
  }

  /**
   * Lê o usuário pela PORTARIA (GoTrue admin / service_role via HTTPS), NÃO por
   * `auth.users` no pg (EasyML §6). Assim o role do banco toca só `public.*`.
   */
  async findUser(userId: string): Promise<AuthUser | null> {
    const { data, error } = await this.serviceRole.run('auth-admin', () =>
      this.supa.client.auth.admin.getUserById(userId),
    );
    if (error || !data?.user) return null;
    return { email: data.user.email ?? null, meta: (data.user.user_metadata ?? {}) as Record<string, unknown> };
  }

  /** `token_hash` de magiclink para o e-mail. Nenhum e-mail é enviado. `null` = o Auth não emitiu. */
  async generateMagicLinkHash(email: string, redirectTo?: string): Promise<string | null> {
    const { data, error } = await this.serviceRole.run('auth-admin', () =>
      this.supa.client.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: redirectTo ? { redirectTo } : undefined,
      }),
    );
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) return null;
    return tokenHash;
  }

  /** `token_hash` de recuperação de senha. `null` = conta inexistente ou erro do Auth. */
  async generateRecoveryHash(email: string): Promise<string | null> {
    const { data, error } = await this.serviceRole.run('auth-admin', () =>
      this.supa.client.auth.admin.generateLink({ type: 'recovery', email }),
    );
    const hashed = data?.properties?.hashed_token;
    if (error || !hashed) return null;
    return hashed;
  }
}
