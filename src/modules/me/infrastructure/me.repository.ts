import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { ServiceRole } from '../../../db/service-role';
import type { MeCompany, MeStoreRow } from '../domain/me.mapper';

/**
 * Leituras do contexto multi-tenant. Toda consulta passa pelo chokepoint `rbac-authz` e é
 * amarrada ao id do dono da sessão (`$1`) — nenhum recorte vem do cliente.
 */
@Injectable()
export class MeRepository {
  constructor(
    private readonly db: DbService,
    private readonly serviceRole: ServiceRole,
  ) {}

  async findRoles(userId: string): Promise<string[]> {
    const roles = await this.serviceRole.run('rbac-authz', () =>
      this.db.query<{ role: string }>('select role::text as role from public.pv_user_roles where user_id = $1::uuid', [
        userId,
      ]),
    );
    return roles.rows.map((r) => r.role);
  }

  /** Todas as empresas — só para quem tem alcance de `system_admin`/`tech_admin`. */
  async findAllCompanies(): Promise<MeCompany[]> {
    const companies = await this.serviceRole.run('rbac-authz', () =>
      this.db.query<MeCompany>('select id, cnpj, name from public.pv_companies order by name'),
    );
    return companies.rows;
  }

  /** Só as empresas em que o usuário tem acesso `approved`. */
  async findApprovedCompanies(userId: string): Promise<MeCompany[]> {
    const companies = await this.serviceRole.run('rbac-authz', () =>
      this.db.query<MeCompany>(
        `select c.id, c.cnpj, c.name
               from public.pv_companies c
               join public.pb_user_company_access uca on uca.company_id = c.id
              where uca.user_id = $1::uuid
                and uca.status = 'approved'
              order by c.name`,
        [userId],
      ),
    );
    return companies.rows;
  }

  /**
   * Lojas visíveis da empresa. O `companyId` já veio validado pelo `TenantGuard` —
   * aqui não se reconfere o vínculo, só se aplica o recorte por loja.
   */
  async findStores(userId: string, companyId: string): Promise<MeStoreRow[]> {
    const { rows } = await this.serviceRole.run('rbac-authz', () =>
      this.db.query<MeStoreRow>(
        `with me as (
           select
             exists (select 1 from public.pv_user_roles ur
                      where ur.user_id = $1::uuid
                        and ur.role::text in ('system_admin', 'tech_admin', 'company_admin')) as full_access
         )
         select
           s.id,
           s.company_id,
           s.trade_name,
           coalesce(s.legacy_store_code::text, '') as legacy_store_code,
           s.store_type::text                      as store_type,
           coalesce(usa.is_default, false)
             or (me.full_access and s.store_type::text = 'headquarters') as is_default,
           (usa.store_id is not null)                                    as has_direct
         from public.pv_stores s
         cross join me
         left join public.pb_user_store_access usa
                on usa.store_id = s.id and usa.user_id = $1::uuid
        where s.company_id = $2::uuid
          and coalesce(s.is_deleted, false) = false
          and (me.full_access or usa.store_id is not null)
        order by s.legacy_store_code`,
        [userId, companyId],
      ),
    );
    return rows;
  }

  /**
   * O recorte é o mesmo de `findStores()` — admin vê todas as lojas das empresas a que tem
   * acesso, usuário comum só as de `pb_user_store_access`. A diferença é o `where`: em vez
   * de uma empresa, todas as que a pessoa alcança. Quem não é admin já é limitado pelo
   * próprio join, então a lista nunca vaza loja de empresa alheia.
   */
  async findAllStores(userId: string): Promise<MeStoreRow[]> {
    const { rows } = await this.serviceRole.run('rbac-authz', () =>
      this.db.query<MeStoreRow>(
        `with me as (
           select
             exists (select 1 from public.pv_user_roles ur
                      where ur.user_id = $1::uuid
                        and ur.role::text in ('system_admin', 'tech_admin', 'company_admin')) as full_access
         ),
         minhas_empresas as (
           select c.id
             from public.pv_companies c
             cross join me
            where me.full_access
               or exists (select 1 from public.pb_user_company_access uca
                           where uca.company_id = c.id
                             and uca.user_id = $1::uuid
                             and uca.status = 'approved')
         )
         select
           s.id,
           s.company_id,
           s.trade_name,
           coalesce(s.legacy_store_code::text, '') as legacy_store_code,
           s.store_type::text                      as store_type,
           coalesce(usa.is_default, false)
             or (me.full_access and s.store_type::text = 'headquarters') as is_default,
           (usa.store_id is not null)                                    as has_direct
         from public.pv_stores s
         cross join me
         join minhas_empresas mc on mc.id = s.company_id
         left join public.pb_user_store_access usa
                on usa.store_id = s.id and usa.user_id = $1::uuid
        where coalesce(s.is_deleted, false) = false
          and (me.full_access or usa.store_id is not null)
        order by s.company_id, s.legacy_store_code`,
        [userId],
      ),
    );
    return rows;
  }
}
