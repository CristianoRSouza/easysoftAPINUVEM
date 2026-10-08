import { Injectable } from '@nestjs/common';
import type { Queryable } from '../../../db/queryable';
import { apiKeyFingerprint, generateApiKey, generatePassword } from '../domain/credentials';
import {
  apiKeyName,
  formatCnpj,
  newStoreNames,
  resolutionOfExisting,
  revealOneTimeSecrets,
  toCompanyData,
  type CompanyData,
  type IdResolution,
  type PreparedStore,
  type ProvisionedStore,
  type ProvisionResult,
  type ResolvedUser,
} from '../domain/provision';
import type { ProvisionInput } from '../dto/provision.schema';
import { TenantAuthClient } from '../infrastructure/tenant-auth.client';
import { TenantsRepository } from '../infrastructure/tenants.repository';

/**
 * Camada 2 do provisionamento. Toda a regra de negócio vive AQUI (não numa RPC no
 * banco): a API resolve os usuários no Auth, gera as chaves e faz os upserts de
 * empresa/lojas/usuários/chaves dentro de UMA transação (atomicidade). Os triggers
 * do banco (outbox p/ POS, estoque, seed, auditoria) continuam disparando sozinhos.
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly repository: TenantsRepository,
    private readonly auth: TenantAuthClient,
  ) {}

  async provision(input: ProvisionInput) {
    const company = toCompanyData(input.company);

    const createdUsers = new Map<string, string>(); // email(lower) -> senha temporária
    const cleartextKeys: string[] = []; // por índice de loja
    const prepared: PreparedStore[] = [];

    for (const st of input.stores) {
      const users: ResolvedUser[] = [];
      for (const u of st.users ?? []) {
        if (!u.email) continue;
        const r = await this.resolveAuthUser(u.email, u.full_name, u.password);
        if (r.isNew) createdUsers.set(u.email.toLowerCase(), r.tempPassword);
        users.push({ user_id: r.userId, email: u.email, full_name: u.full_name, role: u.role });
      }
      const key = generateApiKey();
      cleartextKeys.push(key);
      prepared.push({ input: st, users, ...apiKeyFingerprint(key) });
    }

    // Persiste tudo numa transação, pelo chokepoint (§6).
    const result = await this.repository.inTransaction((tx) => this.persist(tx, company, prepared));

    // Reidrata com o que só o serviço conhece (chave em texto + senha temporária).
    return {
      ...result,
      stores: revealOneTimeSecrets(result.stores, cleartextKeys, createdUsers),
      message: 'Tenant provisionado. As API Keys aparecem só uma vez — guarde com segurança.',
    };
  }

  /** Upserts atômicos (empresa → lojas → usuários → chave). Antes era a RPC fn_provision_tenant. */
  private async persist(
    tx: Queryable,
    company: CompanyData,
    stores: PreparedStore[],
  ): Promise<ProvisionResult> {
    const persistedCompany = await this.persistCompany(tx, company);

    const storesResult: ProvisionedStore[] = [];
    for (const p of stores) {
      storesResult.push(await this.persistStore(tx, persistedCompany.id, p));
    }

    return {
      success: true,
      company: {
        company_id: persistedCompany.id,
        cnpj: company.cnpj,
        is_new: persistedCompany.isNew,
        id_resolution: persistedCompany.resolution,
      },
      stores: storesResult,
    };
  }

  // ---- 1. EMPRESA (id → cnpj → insert) ----
  private async persistCompany(
    tx: Queryable,
    company: CompanyData,
  ): Promise<{ id: string; isNew: boolean; resolution: IdResolution }> {
    let existing: { id: string } | undefined;

    if (company.company_id) {
      existing = await this.repository.findCompanyById(tx, company.company_id);
    }
    if (!existing && company.cnpj) {
      existing = await this.repository.findCompanyByCnpj(tx, company.cnpj);
    }

    if (existing) {
      await this.repository.updateCompany(tx, existing.id, company);
      return {
        id: existing.id,
        isNew: false,
        resolution: resolutionOfExisting(company.company_id, existing.id),
      };
    }
    const id = await this.repository.insertCompany(tx, company);
    return { id, isNew: true, resolution: 'newly_created' };
  }

  // ---- 2. LOJAS ----
  private async persistStore(tx: Queryable, companyId: string, p: PreparedStore): Promise<ProvisionedStore> {
    const st = p.input;
    const inStoreId = st.store_id ?? null;
    const storeCnpj = st.cnpj ? formatCnpj(st.cnpj) : null;
    let storeId: string;
    let storeIsNew = false;
    let storeCode: number;
    let storeRes: IdResolution;
    let existingStore: { id: string; legacy_store_code: number } | undefined;

    if (inStoreId) {
      existingStore = await this.repository.findStoreById(tx, inStoreId, companyId);
    }
    if (!existingStore && storeCnpj) {
      existingStore = await this.repository.findStoreByCnpj(tx, storeCnpj, companyId);
    }

    if (existingStore) {
      storeId = existingStore.id;
      storeCode = existingStore.legacy_store_code;
      storeRes = resolutionOfExisting(inStoreId, storeId);
      await this.repository.updateStore(tx, storeId, st);
    } else {
      storeCode =
        st.legacy_store_code != null ? st.legacy_store_code : await this.repository.nextStoreCode(tx, companyId);
      storeId = await this.repository.insertStore(tx, {
        id: inStoreId,
        companyId,
        code: storeCode,
        ...newStoreNames(st),
        cnpj: storeCnpj,
        input: st,
      });
      storeIsNew = true;
      storeRes = 'newly_created';
    }

    // ---- 3. USUÁRIOS (user_id já resolvido no Auth) ----
    const usersResult: Array<{ user_id: string; email: string }> = [];
    for (const u of p.users) {
      await this.repository.upsertProfile(tx, u);
      await this.repository.grantRole(tx, u);
      await this.repository.approveCompanyAccess(tx, u.user_id, companyId);
      usersResult.push({ user_id: u.user_id, email: u.email });
    }

    // ---- 4. API KEY (idempotente: reusa a ativa; senão cria / reativa) ----
    const active = await this.repository.findActiveApiKey(tx, storeId);
    let apiKeyId: string;
    let apiKeyStatus: 'created' | 'existente';
    if (active) {
      apiKeyId = active.id;
      apiKeyStatus = 'existente';
    } else {
      apiKeyId = await this.repository.upsertApiKey(tx, {
        storeId,
        name: apiKeyName(st),
        prefix: p.apiKeyPrefix,
        hash: p.apiKeyHash,
      });
      apiKeyStatus = 'created';
    }

    return {
      store_id: storeId,
      legacy_store_code: storeCode,
      cnpj: storeCnpj,
      is_new: storeIsNew,
      id_resolution: storeRes,
      api_key_status: apiKeyStatus,
      api_key_id: apiKeyId,
      users: usersResult,
    };
  }

  /**
   * Resolve/cria o usuário SEMPRE pela portaria GoTrue (service_role via HTTPS) — nunca
   * lê `auth.users` no pg, pra o role do banco tocar só `public.*` (EasyML §6). Tenta
   * criar; se o e-mail já existe, resolve o id via generateLink (sem criar/enviar nada
   * ao usuário — só lemos o `data.user` e ignoramos o link).
   */
  private async resolveAuthUser(email: string, fullName?: string, password?: string) {
    const tempPassword = password || generatePassword();
    const created = await this.auth.createUser(email, tempPassword, fullName);
    if (created.userId !== null) return { userId: created.userId, isNew: true as const, tempPassword };

    // Já existe (ou outro erro): resolve o id sem criar.
    const existingId = await this.auth.findUserIdByEmail(email);
    if (existingId) return { userId: existingId, isNew: false as const, tempPassword: '' };

    throw new Error(`Falha ao criar/resolver usuário ${email}: ${created.errorMessage ?? 'desconhecido'}`);
  }
}
