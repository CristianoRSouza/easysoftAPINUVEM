import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import type { Queryable } from '../../../db/queryable';
import { ServiceRole } from '../../../db/service-role';
import type { CompanyData, ResolvedUser, StoreInput } from '../domain/provision';

/** Loja nova: o que o service já decidiu (id, código, nomes) + o resto do payload. */
export interface NewStore {
  id: string | null;
  companyId: string;
  code: number;
  legalName: string;
  tradeName: string;
  cnpj: string | null;
  input: StoreInput;
}

export interface NewApiKey {
  storeId: string;
  name: string;
  prefix: string;
  hash: string;
}

/**
 * Todo o SQL do provisionamento (empresa → lojas → usuários → chave). Antes era a RPC
 * fn_provision_tenant.
 *
 * Cada método recebe o `tx` da transação aberta por `inTransaction` — usar o pool aqui
 * pegaria OUTRA conexão, fora da transação, e a atomicidade iria embora. Este arquivo é
 * cross-tenant POR NATUREZA (a rota é `@ServiceOnly` e existe para CRIAR a empresa), por
 * isso consta na allowlist de `test/tenant-write-safety.guard.spec.ts`.
 */
@Injectable()
export class TenantsRepository {
  constructor(
    private readonly db: DbService,
    private readonly serviceRole: ServiceRole,
  ) {}

  /** Persiste tudo numa transação, pelo chokepoint (§6). */
  inTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.serviceRole.run('provision-tenant', () => this.db.withTransaction((client) => fn(client)));
  }

  // ---- 1. EMPRESA (id → cnpj → insert) ----

  async findCompanyById(tx: Queryable, id: string): Promise<{ id: string } | undefined> {
    return (await tx.query<{ id: string }>('select id from pv_companies where id = $1', [id])).rows[0];
  }

  async findCompanyByCnpj(tx: Queryable, cnpj: string): Promise<{ id: string } | undefined> {
    return (await tx.query<{ id: string }>('select id from pv_companies where cnpj = $1', [cnpj])).rows[0];
  }

  async updateCompany(tx: Queryable, companyId: string, company: CompanyData): Promise<void> {
    await tx.query(
        `update pv_companies set name = coalesce($2, name), document = $3, email = $4,
           phone = $5, address = $6, city = $7, state = $8, updated_at = now() where id = $1`,
      [companyId, company.name, company.document, company.email, company.phone, company.address, company.city, company.state],
    );
  }

  async insertCompany(tx: Queryable, company: CompanyData): Promise<string> {
    const ins = await tx.query<{ id: string }>(
        `insert into pv_companies (id, cnpj, name, document, email, phone, address, city, state)
         values (coalesce($1, gen_random_uuid()), $2, coalesce($3, 'Empresa'), $4, $5, $6, $7, $8, $9)
         returning id`,
      [company.company_id, company.cnpj, company.name, company.document, company.email, company.phone, company.address, company.city, company.state],
    );
    return ins.rows[0].id;
  }

  // ---- 2. LOJAS ----

  async findStoreById(
    tx: Queryable,
    storeId: string,
    companyId: string,
  ): Promise<{ id: string; legacy_store_code: number } | undefined> {
    return (await tx.query<{ id: string; legacy_store_code: number }>('select id, legacy_store_code from pv_stores where id = $1 and company_id = $2', [storeId, companyId])).rows[0];
  }

  async findStoreByCnpj(
    tx: Queryable,
    cnpj: string,
    companyId: string,
  ): Promise<{ id: string; legacy_store_code: number } | undefined> {
    return (await tx.query<{ id: string; legacy_store_code: number }>('select id, legacy_store_code from pv_stores where cnpj = $1 and company_id = $2', [cnpj, companyId])).rows[0];
  }

  async updateStore(tx: Queryable, storeId: string, st: StoreInput): Promise<void> {
    await tx.query(
          `update pv_stores set legal_name=$2, trade_name=$3, state_registration=$4, municipal_registration=$5,
             cnae=$6, address=$7, address_number=$8, address_complement=$9, neighborhood=$10, zip_code=$11,
             phone1=$12, phone2=$13, email=$14, website=$15, updated_at=now() where id=$1`,
      [storeId, st.legal_name ?? null, st.trade_name ?? null, st.state_registration ?? null, st.municipal_registration ?? null,
       st.cnae ?? null, st.address ?? null, st.address_number ?? null, st.address_complement ?? null, st.neighborhood ?? null,
       st.zip_code ?? null, st.phone1 ?? null, st.phone2 ?? null, st.email ?? null, st.website ?? null],
    );
  }

  /** Próximo código legado DENTRO da empresa (`max + 1`). */
  async nextStoreCode(tx: Queryable, companyId: string): Promise<number> {
    const max = await tx.query<{ n: number }>('select coalesce(max(legacy_store_code), 0) + 1 as n from pv_stores where company_id = $1', [companyId]);
    return max.rows[0].n;
  }

  async insertStore(tx: Queryable, store: NewStore): Promise<string> {
    const st = store.input;
    const ins = await tx.query<{ id: string }>(
          `insert into pv_stores (id, company_id, legacy_store_code, legal_name, trade_name, cnpj,
             state_registration, municipal_registration, cnae, address, address_number, address_complement,
             neighborhood, zip_code, phone1, phone2, email, website, store_type)
           values (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::store_type)
           returning id`,
      [store.id, store.companyId, store.code, store.legalName, store.tradeName, store.cnpj, st.state_registration ?? null, st.municipal_registration ?? null,
       st.cnae ?? null, st.address ?? null, st.address_number ?? null, st.address_complement ?? null, st.neighborhood ?? null,
       st.zip_code ?? null, st.phone1 ?? null, st.phone2 ?? null, st.email ?? null, st.website ?? null, st.store_type || 'branch'],
    );
    return ins.rows[0].id;
  }

  // ---- 3. USUÁRIOS (user_id já resolvido no Auth) ----

  async upsertProfile(tx: Queryable, u: ResolvedUser): Promise<void> {
    await tx.query(
          `insert into pb_profiles (id, full_name, email, updated_at) values ($1, $2, $3, now())
           on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, updated_at = now()`,
      [u.user_id, u.full_name || u.email, u.email],
    );
  }

  async grantRole(tx: Queryable, u: ResolvedUser): Promise<void> {
    await tx.query('insert into pv_user_roles (user_id, role) values ($1, $2) on conflict (user_id, role) do nothing', [u.user_id, u.role || 'user']);
  }

  async approveCompanyAccess(tx: Queryable, userId: string, companyId: string): Promise<void> {
    await tx.query(
          `insert into pb_user_company_access (user_id, company_id, status, approved_by, approved_at)
           values ($1, $2, 'approved'::access_status, $1, now())
           on conflict (user_id, company_id) do update set status = 'approved'::access_status, approved_by = excluded.approved_by, approved_at = now()`,
      [userId, companyId],
    );
  }

  // ---- 4. API KEY (idempotente: reusa a ativa; senão cria / reativa) ----

  async findActiveApiKey(tx: Queryable, storeId: string): Promise<{ id: string } | undefined> {
    return (await tx.query<{ id: string }>('select id from pv_store_api_keys where store_id = $1 and is_active = true order by created_at limit 1', [storeId])).rows[0];
  }

  async upsertApiKey(tx: Queryable, key: NewApiKey): Promise<string> {
    const ins = await tx.query<{ id: string }>(
          `insert into pv_store_api_keys (store_id, name, description, key_prefix, key_hash, permissions, is_active, rate_limit_per_minute, rate_limit_per_day)
           values ($1, $2, $3, $4, $5, '["read","write"]'::jsonb, true, 60, 10000)
           on conflict (store_id, name) do update set key_hash = excluded.key_hash, key_prefix = excluded.key_prefix, is_active = true, updated_at = now()
           returning id`,
      [key.storeId, key.name, 'Gerada automaticamente pela EasyFood API', key.prefix, key.hash],
    );
    return ins.rows[0].id;
  }
}
