import { Injectable } from '@nestjs/common';
import { resolveRoleFlags, toMeStore, type MeStore } from '../domain/me.mapper';
import { AuthUserClient } from '../infrastructure/auth-user.client';
import { MeRepository } from '../infrastructure/me.repository';

/**
 * Contexto multi-tenant do usuário logado — quais empresas e lojas ele pode ver.
 *
 * Substitui o `CompanyStoreContext` do browser, que hoje monta isso com 8 consultas
 * diretas ao Supabase e guarda a seleção em `localStorage`. A regra abaixo reproduz
 * **exatamente** a que a UI aplica hoje, para a troca ser invisível ao usuário:
 *
 *   Empresas — `system_admin`/`tech_admin` veem todas; os demais só as que têm em
 *   `pb_user_company_access` com `status = 'approved'`.
 *
 *   Lojas — quem é admin (system/tech/company) vê todas as lojas da empresa; usuário
 *   comum vê só as que tem em `pb_user_store_access`. Loja apagada não aparece.
 *
 * A diferença que importa: antes o `store_id` do filtro vinha do `localStorage` (o
 * cliente declarava em nome de quem agia); agora a lista sai do banco, amarrada ao dono
 * da sessão, e o `TenantGuard` reconfere a cada requisição.
 */
@Injectable()
export class MeService {
  constructor(
    private readonly repository: MeRepository,
    private readonly authUser: AuthUserClient,
  ) {}

  async context(userId: string) {
    const [email, roles] = await Promise.all([
      this.authUser.findEmail(userId),
      this.repository.findRoles(userId),
    ]);

    const { isSystemAdmin, isCompanyAdmin } = resolveRoleFlags(roles);

    const companies = isSystemAdmin
      ? await this.repository.findAllCompanies()
      : await this.repository.findApprovedCompanies(userId);

    return {
      user: { id: userId, email },
      is_system_admin: isSystemAdmin,
      is_company_admin: isCompanyAdmin,
      companies,
    };
  }

  /**
   * Lojas visíveis da empresa. O `companyId` já veio validado pelo `TenantGuard` —
   * aqui não se reconfere o vínculo, só se aplica o recorte por loja.
   */
  async stores(userId: string, companyId: string): Promise<MeStore[]> {
    return (await this.repository.findStores(userId, companyId)).map(toMeStore);
  }

  /**
   * TODAS as lojas visíveis, de todas as empresas — a lista do seletor "onde trabalhar".
   *
   * Por que existe uma rota só para isso: o seletor precisa mostrar empresa **e** loja
   * ANTES de qualquer empresa estar escolhida, e `/me/stores` exige `X-Company-Id`. Sem
   * ela o modal ficava girando para sempre e nenhuma tela carregava dado — era o
   * bloqueio que impedia o modo API de ser usável.
   *
   * A alternativa seria a tela chamar `/me/stores` uma vez por empresa. Para um
   * `system_admin` com 364 empresas isso seriam 364 requisições para desenhar um menu.
   *
   * O recorte é o mesmo de `stores()` — admin vê todas as lojas das empresas a que tem
   * acesso, usuário comum só as de `pb_user_store_access`. A diferença é o `where`: em vez
   * de uma empresa, todas as que a pessoa alcança. Quem não é admin já é limitado pelo
   * próprio join, então a lista nunca vaza loja de empresa alheia.
   */
  async allStores(userId: string): Promise<MeStore[]> {
    return (await this.repository.findAllStores(userId)).map(toMeStore);
  }
}
