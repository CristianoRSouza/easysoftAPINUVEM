import { Injectable } from '@nestjs/common';
import { ServiceRole } from '../../../db/service-role';
import { SupabaseAdmin } from '../../../db/supabase-admin';

/**
 * E-mail do usuário pela PORTARIA (GoTrue admin via HTTPS, chokepoint `auth-admin`) — não
 * por `auth.users` no pg. Se o Auth não devolver o usuário, o e-mail é `null`: a rota de
 * contexto não falha por isso.
 */
@Injectable()
export class AuthUserClient {
  constructor(
    private readonly serviceRole: ServiceRole,
    private readonly supa: SupabaseAdmin,
  ) {}

  async findEmail(userId: string): Promise<string | null> {
    const auth = await this.serviceRole.run('auth-admin', () => this.supa.client.auth.admin.getUserById(userId));
    return auth.data?.user?.email ?? null;
  }
}
