import { describe, expect, it, vi } from 'vitest';
import { TenantGuard } from '../src/common/guards/tenant.guard';
import {
  IS_PUBLIC,
  IS_SERVICE_ONLY,
  IS_SKIP_TENANT,
  REQUIRES_STORE,
} from '../src/common/decorators';
import type { TenantAccess, TenantAccessService } from '../src/common/tenant/tenant-access.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222';
const STORE = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';

type Marks = Partial<Record<string, boolean>>;

function makeCtx(req: Record<string, any>) {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  } as any;
}

function makeGuard(marks: Marks, access: TenantAccess | Error) {
  const reflector = { getAllAndOverride: (key: string) => marks[key] === true } as any;
  const tenant = {
    resolve: vi.fn(async () => {
      if (access instanceof Error) throw access;
      return access;
    }),
  } as unknown as TenantAccessService;
  return { guard: new TenantGuard(reflector, tenant), tenant };
}

const memberNoStore: TenantAccess = { companyOk: true, store: null };
const store = (over: Partial<NonNullable<TenantAccess['store']>>): TenantAccess => ({
  companyOk: true,
  store: {
    exists: true,
    companyId: COMPANY,
    deleted: false,
    isAdmin: false,
    hasDirectAccess: false,
    ...over,
  },
});

const req = (over: Record<string, any> = {}) => ({
  user: { id: USER },
  headers: { 'x-company-id': COMPANY, ...(over.headers ?? {}) },
  ...over,
});

async function expectStatus(p: Promise<unknown>, status: number, error?: string) {
  await expect(p).rejects.toMatchObject({
    status,
    ...(error ? { response: { error } } : {}),
  });
}

describe('TenantGuard — a única barreira entre empresas (o role da API tem BYPASSRLS)', () => {
  describe('quem escapa do guard, e só quem declara', () => {
    it('@Public passa sem header', async () => {
      const { guard } = makeGuard({ [IS_PUBLIC]: true }, memberNoStore);
      await expect(guard.canActivate(makeCtx({ headers: {} }))).resolves.toBe(true);
    });

    it('@ServiceOnly passa sem header (máquina-a-máquina é cross-tenant)', async () => {
      const { guard } = makeGuard({ [IS_SERVICE_ONLY]: true }, memberNoStore);
      await expect(guard.canActivate(makeCtx({ headers: {} }))).resolves.toBe(true);
    });

    it('@SkipTenant passa sem header (as 4 rotas de sessão que já existiam)', async () => {
      const { guard } = makeGuard({ [IS_SKIP_TENANT]: true }, memberNoStore);
      await expect(guard.canActivate(makeCtx({ headers: {} }))).resolves.toBe(true);
    });

    it('rota SEM decorator nenhum já nasce exigindo tenant (falha fechado)', async () => {
      const { guard } = makeGuard({}, memberNoStore);
      await expectStatus(guard.canActivate(makeCtx({ user: { id: USER }, headers: {} })), 400, 'company_required');
    });
  });

  describe('validação do header', () => {
    it('X-Company-Id malformado → 400, sem ir ao banco', async () => {
      const { guard, tenant } = makeGuard({}, memberNoStore);
      await expectStatus(
        guard.canActivate(makeCtx(req({ headers: { 'x-company-id': 'nao-e-uuid' } }))),
        400,
        'invalid_company',
      );
      expect(tenant.resolve).not.toHaveBeenCalled();
    });

    it('X-Store-Id malformado → 400', async () => {
      const { guard } = makeGuard({}, memberNoStore);
      await expectStatus(
        guard.canActivate(makeCtx(req({ headers: { 'x-company-id': COMPANY, 'x-store-id': 'xx' } }))),
        400,
        'invalid_store',
      );
    });

    it('@RequireStore sem X-Store-Id → 400', async () => {
      const { guard } = makeGuard({ [REQUIRES_STORE]: true }, memberNoStore);
      await expectStatus(guard.canActivate(makeCtx(req())), 400, 'store_required');
    });
  });

  describe('autorização', () => {
    it('membro da empresa, sem loja pedida → passa e popula req.companyId', async () => {
      const { guard } = makeGuard({}, memberNoStore);
      const r = req();
      await expect(guard.canActivate(makeCtx(r))).resolves.toBe(true);
      expect(r.companyId).toBe(COMPANY);
      expect(r.storeId).toBeNull();
    });

    it('NÃO é membro da empresa → 403', async () => {
      const { guard } = makeGuard({}, { companyOk: false, store: null });
      await expectStatus(guard.canActivate(makeCtx(req())), 403, 'forbidden');
    });

    it('a identidade vem SEMPRE da sessão, nunca do cliente', async () => {
      const { guard, tenant } = makeGuard({}, memberNoStore);
      // O cliente tenta injetar outro usuário por header — deve ser ignorado.
      await guard.canActivate(
        makeCtx(req({ headers: { 'x-company-id': COMPANY, 'x-user-id': 'usuario-forjado' } })),
      );
      expect(tenant.resolve).toHaveBeenCalledWith(USER, COMPANY, null);
    });

    it('loja de OUTRA empresa → 403 (o vazamento que o guard existe para impedir)', async () => {
      const { guard } = makeGuard({}, store({ companyId: OTHER_COMPANY, hasDirectAccess: true }));
      await expectStatus(
        guard.canActivate(makeCtx(req({ headers: { 'x-company-id': COMPANY, 'x-store-id': STORE } }))),
        403,
        'forbidden',
      );
    });

    it('loja apagada → 403, mesmo com acesso', async () => {
      const { guard } = makeGuard({}, store({ deleted: true, hasDirectAccess: true }));
      await expectStatus(
        guard.canActivate(makeCtx(req({ headers: { 'x-company-id': COMPANY, 'x-store-id': STORE } }))),
        403,
      );
    });

    it('loja inexistente → 403 (não 404: não vira verificador de existência)', async () => {
      const { guard } = makeGuard({}, store({ exists: false, companyId: null }));
      await expectStatus(
        guard.canActivate(makeCtx(req({ headers: { 'x-company-id': COMPANY, 'x-store-id': STORE } }))),
        403,
      );
    });

    it('sem acesso direto e sem ser admin → 403', async () => {
      const { guard } = makeGuard({}, store({}));
      await expectStatus(
        guard.canActivate(makeCtx(req({ headers: { 'x-company-id': COMPANY, 'x-store-id': STORE } }))),
        403,
      );
    });

    it('usuário comum com acesso direto à loja → passa (não precisa ser admin)', async () => {
      const { guard } = makeGuard({}, store({ hasDirectAccess: true }));
      const r = req({ headers: { 'x-company-id': COMPANY, 'x-store-id': STORE } });
      await expect(guard.canActivate(makeCtx(r))).resolves.toBe(true);
      expect(r.storeId).toBe(STORE);
      expect(r.isCompanyAdmin).toBe(false);
    });

    it('admin da empresa → passa em qualquer loja dela e marca req.isCompanyAdmin', async () => {
      const { guard } = makeGuard({}, store({ isAdmin: true }));
      const r = req({ headers: { 'x-company-id': COMPANY, 'x-store-id': STORE } });
      await expect(guard.canActivate(makeCtx(r))).resolves.toBe(true);
      expect(r.isCompanyAdmin).toBe(true);
    });
  });

  describe('falha de infra não vira falha de permissão', () => {
    it('erro do banco → 503, não 403', async () => {
      const { guard } = makeGuard({}, new Error('connection terminated'));
      await expectStatus(guard.canActivate(makeCtx(req())), 503, 'service_unavailable');
    });

    it('sem req.user (ordem dos guards trocada) → 503 de bug, não 401 silencioso', async () => {
      const { guard } = makeGuard({}, memberNoStore);
      await expectStatus(
        guard.canActivate(makeCtx({ headers: { 'x-company-id': COMPANY } })),
        503,
      );
    });
  });
});
