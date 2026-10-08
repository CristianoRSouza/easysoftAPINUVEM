import { describe, expect, it, vi } from 'vitest';
import { MeService } from '../src/modules/me/application/me.service';
import { AuthUserClient } from '../src/modules/me/infrastructure/auth-user.client';
import { MeRepository } from '../src/modules/me/infrastructure/me.repository';
import { TenantAccessService } from '../src/common/tenant/tenant-access.service';
import { PODE_ADMINISTRAR_LOJA_SQL } from '../src/common/tenant/pode-administrar-loja';
import { StoresService } from '../src/modules/stores/application/stores.service';
import { StoreAdminRepository } from '../src/common/tenant/store-admin.repository';
import { TotemsService } from '../src/modules/totems/application/totems.service';
import type { DbService } from '../src/db/db.service';
import type { ServiceRole } from '../src/db/service-role';
import type { SupabaseAdmin } from '../src/db/supabase-admin';
import type { Env } from '../src/config/env';

/**
 * A listagem e o guard TÊM de concordar sobre quem é admin.
 *
 * O bug que este arquivo tranca custou uma sessão inteira de depuração e deixava o app
 * inteiro inutilizável para quem administra o sistema:
 *
 *   `is_company_admin_for_store` exige linha em `pb_user_company_access`. Um `system_admin`
 *   não tem nenhuma — ele enxerga tudo por PAPEL, não por concessão. Então
 *   `has_company_access` dizia SIM para a empresa, `/me/stores` LISTAVA a loja, e o
 *   `TenantGuard` NEGAVA a mesma loja com 403 "Sem acesso a esta loja".
 *
 * A tela oferecia o que o servidor recusava. Nenhuma página abria, e o erro não apontava
 * para a causa: dizia "sem acesso" a uma loja que o próprio servidor tinha acabado de
 * oferecer na lista.
 *
 * Estes testes olham o SQL, não o resultado: o banco de verdade é quem responde em
 * produção, e o que se pode garantir aqui é que as duas consultas fazem a MESMA pergunta.
 */

const USER = '44444444-4444-4444-8444-444444444444';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const STORE = '33333333-3333-4333-8333-333333333333';

const serviceRole = { run: (_r: string, fn: any) => fn() } as unknown as ServiceRole;
const supa = {
  client: { auth: { admin: { getUserById: async () => ({ data: { user: { email: null } } }) } } },
} as unknown as SupabaseAdmin;

function fakeDb(responses: Array<{ rows: any[] }> = []) {
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

/** Sem cache: cada teste tem de ver a consulta de verdade, não uma resposta guardada. */
const env = { TENANT_CACHE_SECONDS: 0 } as unknown as Env;
const semEspacos = (s: string) => s.replace(/\s+/g, ' ');

describe('guard e listagem concordam sobre quem é admin', () => {
  it('o guard reconhece system_admin/tech_admin por PAPEL, não por concessão', async () => {
    const { db, calls } = fakeDb([{ rows: [{ company_ok: true }] }]);
    await new TenantAccessService(db, serviceRole, env).resolve(USER, COMPANY, STORE);

    const sql = semEspacos(calls[0].sql);
    // Sem este termo, o system_admin leva 403 em toda tela que precise de loja.
    expect(sql).toContain("'system_admin', 'tech_admin'");
    expect(sql).toContain('pv_user_roles');
    // E o caminho antigo continua valendo para company_admin, que É por concessão.
    expect(sql).toContain('is_company_admin_for_store');
    expect(sql).toContain('full_access');
  });

  it('o guard segue exigindo a loja no parâmetro — nada vem do corpo', async () => {
    const { db, calls } = fakeDb([{ rows: [{ company_ok: true }] }]);
    await new TenantAccessService(db, serviceRole, env).resolve(USER, COMPANY, STORE);
    expect(calls[0].params).toEqual([USER, COMPANY, STORE]);
  });

  it('a listagem de lojas usa os MESMOS papéis do guard', async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    await new MeService(new MeRepository(db, serviceRole), new AuthUserClient(serviceRole, supa)).stores(USER, COMPANY);
    const sql = semEspacos(calls[0].sql);
    expect(sql).toContain("'system_admin', 'tech_admin', 'company_admin'");
  });

  it('sem loja pedida, o guard não inventa checagem de loja', async () => {
    const { db, calls } = fakeDb([{ rows: [{ company_ok: true }] }]);
    const r = await new TenantAccessService(db, serviceRole, env).resolve(USER, COMPANY, null);
    expect(r.store).toBeNull();
    expect(calls[0].params[2]).toBeNull();
  });
});

/**
 * A mesma pergunta estava respondida em QUATRO lugares, e três respondiam errado.
 *
 * Todos chamavam `is_company_admin_for_store` sozinha, que exige concessão em
 * `pb_user_company_access` — e o system_admin não tem nenhuma. Efeito prático: quem
 * administra o sistema levava 403 ao abrir qualquer tela, ao gerar código de primeiro
 * acesso e ao cifrar segredo TEF.
 */
describe('a regra de "pode administrar esta loja" vive num lugar só', () => {
  it('o SQL compartilhado cobre papel E concessão', () => {
    const sql = semEspacos(PODE_ADMINISTRAR_LOJA_SQL);
    expect(sql).toContain("'system_admin', 'tech_admin'");
    expect(sql).toContain('is_company_admin_for_store');
    // Ter acesso à loja deixa USAR, não ADMINISTRAR — gerar código e cifrar segredo
    // exigem mais, e é de propósito.
    expect(sql).not.toContain('pb_user_store_access');
  });

  it('gerar código de primeiro acesso usa o SQL compartilhado', async () => {
    const { db, calls } = fakeDb([{ rows: [{ ok: false }] }]);
    const svc = new StoresService(new StoreAdminRepository(db, serviceRole), { SENSITIVE_SECRET_MASTER_KEY_BASE64: 'x' } as any);
    await expect(
      svc.issueBootstrapCode(USER, STORE, 'alguem@empresa.com'),
    ).rejects.toMatchObject({ status: 403 });
    expect(semEspacos(calls[0].sql)).toBe(semEspacos(PODE_ADMINISTRAR_LOJA_SQL));
    expect(calls[0].params).toEqual([USER, STORE]);
  });

  it('cifrar segredo TEF usa o SQL compartilhado', async () => {
    const { db, calls } = fakeDb([{ rows: [{ ok: false }] }]);
    const svc = new TotemsService(new StoreAdminRepository(db, serviceRole), {
      SENSITIVE_SECRET_MASTER_KEY_BASE64: 'x',
    } as any);
    await expect(svc.encryptTefSecrets(USER, STORE, 'a', 'b')).rejects.toMatchObject({
      status: 403,
    });
    expect(semEspacos(calls[0].sql)).toBe(semEspacos(PODE_ADMINISTRAR_LOJA_SQL));
  });

  it('o guard diz a MESMA coisa, ainda que por consulta própria', async () => {
    // Ele repete o predicado em vez de importar porque resolve empresa e loja numa ida
    // só — mas os termos têm de bater, e é isso que este teste tranca.
    const { db, calls } = fakeDb([{ rows: [{ company_ok: true }] }]);
    await new TenantAccessService(db, serviceRole, env).resolve(USER, COMPANY, STORE);
    const guard = semEspacos(calls[0].sql);
    for (const termo of ["'system_admin', 'tech_admin'", 'is_company_admin_for_store']) {
      expect(guard).toContain(termo);
    }
  });
});

/**
 * `/me/all-stores` — a rota que faltava para o seletor "onde trabalhar" existir.
 *
 * Ela é `@SkipTenant` porque roda ANTES de haver empresa escolhida. Isso só é seguro
 * porque o recorte vem do DONO DA SESSÃO, nunca de cabeçalho: não há como pedir a loja de
 * outra empresa, porque nada no pedido diz qual empresa.
 */
describe('/me/all-stores — o recorte vem da sessão, não do pedido', () => {
  it('recebe SÓ o id do usuário — nenhuma empresa vem de fora', async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    await new MeService(new MeRepository(db, serviceRole), new AuthUserClient(serviceRole, supa)).allStores(USER);
    expect(calls[0].params).toEqual([USER]);
  });

  it('limita às empresas que o usuário alcança', async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    await new MeService(new MeRepository(db, serviceRole), new AuthUserClient(serviceRole, supa)).allStores(USER);
    const sql = semEspacos(calls[0].sql);
    expect(sql).toContain('minhas_empresas');
    expect(sql).toContain('pb_user_company_access');
    expect(sql).toContain("uca.status = 'approved'");
    // Usuário comum: só as lojas que ele tem de fato.
    expect(sql).toContain('me.full_access or usa.store_id is not null');
    // Loja apagada não aparece para ninguém.
    expect(sql).toContain('coalesce(s.is_deleted, false) = false');
  });

  it('aplica o mesmo recorte de papéis da rota por empresa', async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    await new MeService(new MeRepository(db, serviceRole), new AuthUserClient(serviceRole, supa)).allStores(USER);
    expect(semEspacos(calls[0].sql)).toContain("'system_admin', 'tech_admin', 'company_admin'");
  });

  it('não devolve o campo interno has_direct', async () => {
    const { db } = fakeDb([
      { rows: [{ id: STORE, company_id: COMPANY, trade_name: 'L', legacy_store_code: '1', store_type: null, is_default: true, has_direct: true }] },
    ]);
    const r = await new MeService(new MeRepository(db, serviceRole), new AuthUserClient(serviceRole, supa)).allStores(USER);
    expect(r[0]).not.toHaveProperty('has_direct');
    expect(r[0].id).toBe(STORE);
  });
});
