import { Injectable } from '@nestjs/common';
import { ServiceRole } from '../../../db/service-role';
import { SupabaseAdmin } from '../../../db/supabase-admin';

/**
 * Usuários SEMPRE pela portaria GoTrue (service_role via HTTPS) — nunca lê `auth.users`
 * no pg, pra o role do banco tocar só `public.*` (EasyML §6). Cada chamada passa pelo
 * chokepoint `auth-admin`.
 */
@Injectable()
export class TenantAuthClient {
  constructor(
    private readonly serviceRole: ServiceRole,
    private readonly supa: SupabaseAdmin,
  ) {}

  /** Tenta criar. `userId` nulo = não criou (já existe, ou outro erro — ver `errorMessage`). */
  async createUser(
    email: string,
    password: string,
    fullName?: string,
  ): Promise<{ userId: string | null; errorMessage: string | undefined }> {
    const created = await this.serviceRole.run('auth-admin', () =>
      this.supa.client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName || email, provisioned_by_api: true },
      }),
    );
    return {
      userId: created.data?.user ? created.data.user.id : null,
      errorMessage: created.error?.message,
    };
  }

  /**
   * id de um usuário existente pelo e-mail, via GoTrue (generateLink devolve o data.user).
   * Não cria nem envia nada ao usuário — só lemos o `data.user` e ignoramos o link.
   */
  async findUserIdByEmail(email: string): Promise<string | null> {
    const { data } = await this.serviceRole.run('auth-admin', () =>
      this.supa.client.auth.admin.generateLink({ type: 'magiclink', email }),
    );
    return data?.user?.id ?? null;
  }
}
