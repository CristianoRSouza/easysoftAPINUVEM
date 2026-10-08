import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { ServiceRole } from '../../db/service-role';
import { ENV, type Env } from '../../config/env';

export interface TenantAccess {
  /** O usuário pertence à empresa pedida (ou é system_admin). */
  companyOk: boolean;
  /** `null` quando nenhum store foi pedido. */
  store: null | {
    exists: boolean;
    /** Empresa DONA da loja — comparada com a empresa pedida pelo chamador. */
    companyId: string | null;
    deleted: boolean;
    /** admin da empresa dona (system_admin / company_admin / tech_admin). */
    isAdmin: boolean;
    /** tem linha em pb_user_store_access para esta loja. */
    hasDirectAccess: boolean;
  };
}

/**
 * Resolve, no BANCO, se o usuário da sessão pode agir em nome de uma empresa/loja.
 *
 * Por que isto existe: o role da API tem BYPASSRLS de propósito (ver
 * `sql/least-privilege-role.sql` — a API é a camada confiável que substitui o
 * `authenticated` do browser). Com RLS fora do caminho, **a checagem em código é a
 * única barreira entre empresas**. Não é defesa em profundidade aqui; é a defesa.
 *
 * A regra de loja reproduz exatamente a que a UI aplica hoje no seletor de lojas
 * (`CompanyStoreContext.fetchStores`): admin da empresa enxerga todas as lojas dela;
 * usuário comum enxerga só as que tem em `pb_user_store_access`. Loja apagada
 * (`is_deleted`) não conta para ninguém.
 *
 * Cache em memória curto (`TENANT_CACHE_SECONDS`): concessão de acesso é ato
 * administrativo, não evento de segurança urgente como revogar sessão — por isso
 * aqui o default é ligado, e no cache de SESSÃO é desligado.
 */
@Injectable()
export class TenantAccessService {
  private readonly cache = new Map<string, { at: number; value: TenantAccess }>();

  constructor(
    private readonly db: DbService,
    private readonly serviceRole: ServiceRole,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async resolve(userId: string, companyId: string, storeId: string | null): Promise<TenantAccess> {
    const key = `${userId}|${companyId}|${storeId ?? '-'}`;
    const ttlMs = this.env.TENANT_CACHE_SECONDS * 1000;
    if (ttlMs > 0) {
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    }

    // UMA ida ao banco, com ou sem loja: o LEFT JOIN devolve NULLs quando storeId é null.
    const { rows } = await this.serviceRole.run('rbac-authz', () =>
      this.db.query<{
        company_ok: boolean;
        store_id: string | null;
        store_company_id: string | null;
        store_deleted: boolean | null;
        store_admin: boolean | null;
        store_direct: boolean | null;
      }>(
        `with me as (
           /*
            * ⚠️ O termo que faltava — sem ele o system_admin não abria NENHUMA tela.
            *
            * A definição de "pode administrar esta loja" vive em
            * common/tenant/pode-administrar-loja.ts, e o texto abaixo tem de continuar
            * dizendo a MESMA coisa. Está repetido aqui, e não importado, porque esta
            * consulta resolve empresa e loja de uma vez só — trazer o predicado pronto
            * exigiria uma segunda ida ao banco em TODA requisição.
            *
            * O teste tenant-admin-coerencia.spec.ts existe justamente para as duas não
            * divergirem: guard e listagem discordando é o pior dos mundos, porque a tela
            * passa a oferecer o que o servidor recusa.
            */
           select exists (
             select 1 from public.pv_user_roles ur
              where ur.user_id = $1::uuid
                and ur.role::text in ('system_admin', 'tech_admin')
           ) as full_access
         )
         select
           public.has_company_access($1::uuid, $2::uuid)        as company_ok,
           s.id                                                 as store_id,
           s.company_id                                         as store_company_id,
           coalesce(s.is_deleted, false)                        as store_deleted,
           case when s.id is null then null
                else me.full_access
                     or public.is_company_admin_for_store($1::uuid, s.id) end as store_admin,
           case when s.id is null then null
                else exists (select 1
                               from public.pb_user_store_access usa
                              where usa.user_id = $1::uuid
                                and usa.store_id = s.id) end    as store_direct
         from (select $3::uuid as sid) q
         cross join me
         left join public.pv_stores s on s.id = q.sid`,
        [userId, companyId, storeId],
      ),
    );

    const r = rows[0];
    const value: TenantAccess = {
      companyOk: r?.company_ok === true,
      store:
        storeId == null
          ? null
          : {
              exists: r?.store_id != null,
              companyId: r?.store_company_id ?? null,
              deleted: r?.store_deleted === true,
              isAdmin: r?.store_admin === true,
              hasDirectAccess: r?.store_direct === true,
            },
    };

    if (ttlMs > 0) {
      // Teto simples de memória: acesso é por (usuário, empresa, loja) e o TTL é curto.
      if (this.cache.size > 5_000) this.cache.clear();
      this.cache.set(key, { at: Date.now(), value });
    }
    return value;
  }

  /** Esvazia o cache — use após mudar acesso de usuário (e nos testes). */
  clearCache(): void {
    this.cache.clear();
  }
}
