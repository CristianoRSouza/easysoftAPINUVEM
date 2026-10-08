import { describe, expect, it, vi } from 'vitest';
import { MeService } from '../src/modules/me/application/me.service';
import { AuthUserClient } from '../src/modules/me/infrastructure/auth-user.client';
import { MeRepository } from '../src/modules/me/infrastructure/me.repository';
import type { DbService } from '../src/db/db.service';
import type { ServiceRole } from '../src/db/service-role';
import type { SupabaseAdmin } from '../src/db/supabase-admin';

const USER = '44444444-4444-4444-8444-444444444444';
const COMPANY = '11111111-1111-4111-8111-111111111111';

/** Encaminha ao fn — o chokepoint é observabilidade, não fronteira (ver service-role.ts). */
const serviceRole = { run: (_r: string, fn: any) => fn() } as unknown as ServiceRole;

const supaWith = (email: string | null) =>
  ({
    client: { auth: { admin: { getUserById: async () => ({ data: { user: { email } } }) } } },
  }) as unknown as SupabaseAdmin;

/** Monta o service como o Nest monta: repositório e cliente do Auth sobre os mesmos fakes. */
const meService = (db: DbService, supa: SupabaseAdmin) =>
  new MeService(new MeRepository(db, serviceRole), new AuthUserClient(serviceRole, supa));

/** Devolve as respostas na ordem em que forem pedidas e grava as queries feitas. */
function fakeDb(responses: Array<{ rows: any[] }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return responses[i++] ?? { rows: [] };
    }),
  } as unknown as DbService;
  return { db, calls };
}

describe('MeService — o contexto multi-tenant sai do banco, não do localStorage', () => {
  describe('context()', () => {
    it('usuário comum: só as empresas com acesso approved, filtradas pelo id da SESSÃO', async () => {
      const { db, calls } = fakeDb([
        { rows: [{ role: 'store_user' }] },
        { rows: [{ id: COMPANY, cnpj: '00.000.000/0000-00', name: 'Empresa A' }] },
      ]);
      const out = await meService(db, supaWith('a@b.c')).context(USER);

      expect(out.is_system_admin).toBe(false);
      expect(out.is_company_admin).toBe(false);
      expect(out.companies).toHaveLength(1);
      expect(out.user).toEqual({ id: USER, email: 'a@b.c' });

      const companyQuery = calls[1];
      expect(companyQuery.sql).toContain('pb_user_company_access');
      expect(companyQuery.sql).toContain("status = 'approved'");
      expect(companyQuery.params).toEqual([USER]);
    });

    it('system_admin: todas as empresas, sem filtro por usuário', async () => {
      const { db, calls } = fakeDb([{ rows: [{ role: 'system_admin' }] }, { rows: [] }]);
      const out = await meService(db, supaWith(null)).context(USER);

      expect(out.is_system_admin).toBe(true);
      expect(calls[1].sql).not.toContain('pb_user_company_access');
      expect(calls[1].params).toEqual([]);
    });

    it('tech_admin tem o mesmo alcance de system_admin (paridade com a UI de hoje)', async () => {
      const { db } = fakeDb([{ rows: [{ role: 'tech_admin' }] }, { rows: [] }]);
      const out = await meService(db, supaWith(null)).context(USER);
      expect(out.is_system_admin).toBe(true);
    });

    it('company_admin NÃO vira system_admin', async () => {
      const { db } = fakeDb([{ rows: [{ role: 'company_admin' }] }, { rows: [] }]);
      const out = await meService(db, supaWith(null)).context(USER);
      expect(out.is_system_admin).toBe(false);
      expect(out.is_company_admin).toBe(true);
    });

    it('email indisponível no GoTrue não derruba a rota', async () => {
      const { db } = fakeDb([{ rows: [] }, { rows: [] }]);
      const supa = {
        client: { auth: { admin: { getUserById: async () => ({ data: null }) } } },
      } as unknown as SupabaseAdmin;
      const out = await meService(db, supa).context(USER);
      expect(out.user.email).toBeNull();
    });
  });

  describe('stores()', () => {
    it('filtra por empresa E por usuário — nunca só por empresa', async () => {
      const { db, calls } = fakeDb([{ rows: [] }]);
      await meService(db, supaWith(null)).stores(USER, COMPANY);
      expect(calls[0].params).toEqual([USER, COMPANY]);
      expect(calls[0].sql).toContain('pb_user_store_access');
      // Loja apagada não pode aparecer para ninguém.
      expect(calls[0].sql).toContain('is_deleted');
    });

    it('não vaza o campo interno has_direct na resposta', async () => {
      const { db } = fakeDb([
        {
          rows: [
            {
              id: 's1',
              company_id: COMPANY,
              trade_name: 'Loja Centro',
              legacy_store_code: '1',
              store_type: 'headquarters',
              is_default: true,
              has_direct: false,
            },
          ],
        },
      ]);
      const [store] = await meService(db, supaWith(null)).stores(USER, COMPANY);
      expect(store).not.toHaveProperty('has_direct');
      expect(store.is_default).toBe(true);
    });
  });
});
