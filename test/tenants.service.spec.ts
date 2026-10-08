import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'crypto';
import { TenantsService } from '../src/modules/tenants/application/tenants.service';
import { TenantAuthClient } from '../src/modules/tenants/infrastructure/tenant-auth.client';
import { TenantsRepository } from '../src/modules/tenants/infrastructure/tenants.repository';
import type { DbService } from '../src/db/db.service';
import type { ServiceRole } from '../src/db/service-role';
import type { SupabaseAdmin } from '../src/db/supabase-admin';

/**
 * O provisionamento — contrato de entrada herdado da edge function `provision-tenant`,
 * chamado pelo Sync-PG-SB e nunca por um browser.
 *
 * O que estes testes protegem, e por que cada um importa:
 *
 *   • **Idempotência por IDENTIDADE, não por repetição.** Reenviar o mesmo payload tem
 *     que ATUALIZAR, nunca duplicar. O campo `id_resolution` é o que conta ao chamador
 *     por qual caminho a identidade foi resolvida — e ele é lido do outro lado.
 *   • **Segredo que aparece uma vez.** `api_key` só vem quando foi criada agora; se já
 *     havia chave ativa, vem `null` e a antiga NÃO é revelada. O banco guarda `sha256` +
 *     prefixo. Um teste aqui é barato; descobrir isso vazando, não.
 *   • **Atomicidade parcial.** Os usuários são resolvidos no Auth ANTES da transação, de
 *     propósito — então um rollback não os desfaz. Está documentado, e o teste registra
 *     que é assim mesmo, para ninguém "consertar" sem saber o que está trocando.
 */

const EMPRESA = '11111111-1111-4111-8111-111111111111';
const LOJA = '22222222-2222-4222-8222-222222222222';
const USUARIO = '99999999-9999-4999-8999-999999999999';

interface EstadoDoBanco {
  empresaPorId?: string;
  empresaPorCnpj?: string;
  lojaPorId?: { id: string; legacy_store_code: number };
  lojaPorCnpj?: { id: string; legacy_store_code: number };
  chaveAtiva?: string;
  proximoCodigo?: number;
}

/**
 * Banco falso roteado por SQL. Não tenta ser um Postgres — só responde o que cada
 * consulta do `persist` espera, para a LÓGICA de resolução poder ser exercitada.
 */
function bancoFalso(estado: EstadoDoBanco = {}) {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql, params });
    const s = sql.toLowerCase().replace(/\s+/g, ' ');

    if (s.includes('from pv_companies where id =')) {
      return { rows: estado.empresaPorId ? [{ id: estado.empresaPorId }] : [] };
    }
    if (s.includes('from pv_companies where cnpj =')) {
      return { rows: estado.empresaPorCnpj ? [{ id: estado.empresaPorCnpj }] : [] };
    }
    if (s.startsWith('insert into pv_companies')) return { rows: [{ id: EMPRESA }] };

    if (s.includes('from pv_stores where id =')) {
      return { rows: estado.lojaPorId ? [estado.lojaPorId] : [] };
    }
    if (s.includes('from pv_stores where cnpj =')) {
      return { rows: estado.lojaPorCnpj ? [estado.lojaPorCnpj] : [] };
    }
    if (s.includes('max(legacy_store_code)')) {
      return { rows: [{ n: estado.proximoCodigo ?? 1 }] };
    }
    if (s.startsWith('insert into pv_stores')) return { rows: [{ id: LOJA }] };

    if (s.includes('from pv_store_api_keys where store_id')) {
      return { rows: estado.chaveAtiva ? [{ id: estado.chaveAtiva }] : [] };
    }
    if (s.startsWith('insert into pv_store_api_keys')) return { rows: [{ id: 'chave-nova' }] };

    return { rows: [] };
  });

  const db = {
    withTransaction: async (fn: any) => fn({ query }),
  } as unknown as DbService;

  return { db, consultas, query };
}

/** GoTrue falso: `novo` decide se o createUser "cria" ou se o e-mail já existia. */
function authFalso(novo: boolean) {
  return {
    client: {
      auth: {
        admin: {
          createUser: vi.fn(async () =>
            novo ? { data: { user: { id: USUARIO } }, error: null } : { data: null, error: { message: 'já existe' } },
          ),
          generateLink: vi.fn(async () => ({ data: { user: { id: USUARIO } }, error: null })),
        },
      },
    },
  } as unknown as SupabaseAdmin;
}

const serviceRole = { run: (_r: string, fn: any) => fn() } as unknown as ServiceRole;

/** Monta o service como o Nest monta: repositório e cliente do Auth sobre os mesmos fakes. */
const tenantsService = (db: DbService, auth: SupabaseAdmin) =>
  new TenantsService(new TenantsRepository(db, serviceRole), new TenantAuthClient(serviceRole, auth));

const svc = (estado: EstadoDoBanco = {}, usuarioNovo = true) => {
  const b = bancoFalso(estado);
  return { service: tenantsService(b.db, authFalso(usuarioNovo)), ...b };
};

/** Payload mínimo; `over` sobrescreve o que o teste quiser. */
const entrada = (over: any = {}) => ({
  company: { name: 'Empresa Teste', ...(over.company ?? {}) },
  stores: over.stores ?? [{ trade_name: 'Loja Centro' }],
});

describe('TenantsService.provision — idempotência por identidade', () => {
  it('empresa achada pelo id informado: `client_provided_match`', async () => {
    const { service } = svc({ empresaPorId: EMPRESA });
    const out = await service.provision(entrada({ company: { company_id: EMPRESA } }) as any);

    expect(out.company.id_resolution).toBe('client_provided_match');
    expect(out.company.is_new).toBe(false);
  });

  it('empresa achada pelo CNPJ (id não veio): `matched_by_cnpj`', async () => {
    const { service } = svc({ empresaPorCnpj: EMPRESA });
    const out = await service.provision(entrada({ company: { cnpj: '12345678000199' } }) as any);

    expect(out.company.id_resolution).toBe('matched_by_cnpj');
    expect(out.company.is_new).toBe(false);
  });

  it('nada encontrado: insere e marca `newly_created`', async () => {
    const { service } = svc();
    const out = await service.provision(entrada() as any);

    expect(out.company.id_resolution).toBe('newly_created');
    expect(out.company.is_new).toBe(true);
  });

  it('reenviar o mesmo payload ATUALIZA a empresa — não duplica', async () => {
    const { service, consultas } = svc({ empresaPorId: EMPRESA });
    await service.provision(entrada({ company: { company_id: EMPRESA } }) as any);

    const sqls = consultas.map((c) => c.sql.toLowerCase());
    expect(sqls.some((s) => s.includes('update pv_companies'))).toBe(true);
    expect(sqls.some((s) => s.trim().startsWith('insert into pv_companies'))).toBe(false);
  });

  it('a loja é procurada pelo id ANTES do cnpj, e sempre DENTRO da empresa resolvida', async () => {
    const { service, consultas } = svc({ lojaPorId: { id: LOJA, legacy_store_code: 3 } });
    await service.provision(entrada({ stores: [{ store_id: LOJA, cnpj: '12345678000199' }] }) as any);

    const porId = consultas.find((c) => c.sql.toLowerCase().includes('from pv_stores where id ='));
    expect(porId).toBeDefined();
    // O segundo parâmetro é a empresa: sem isso, a loja de outra empresa entraria no match.
    expect(porId!.params).toHaveLength(2);

    // Achou pelo id — nem chega a perguntar pelo cnpj.
    expect(consultas.some((c) => c.sql.toLowerCase().includes('from pv_stores where cnpj ='))).toBe(false);
  });

  it('loja achada por cnpj dentro da empresa: `matched_by_cnpj` e mantém o código legado', async () => {
    const { service } = svc({ lojaPorCnpj: { id: LOJA, legacy_store_code: 7 } });
    const out = await service.provision(entrada({ stores: [{ cnpj: '12345678000199' }] }) as any);

    expect(out.stores[0].id_resolution).toBe('matched_by_cnpj');
    expect(out.stores[0].legacy_store_code).toBe(7);
  });
});

describe('TenantsService.provision — segredos que aparecem uma única vez', () => {
  it('chave criada agora: volta em texto, e o banco recebe só sha256 + prefixo', async () => {
    const { service, consultas } = svc();
    const out = await service.provision(entrada() as any);

    const chave = out.stores[0].api_key!;
    expect(out.stores[0].api_key_status).toBe('created');
    expect(chave).toMatch(/^sk_live_/);

    const ins = consultas.find((c) => c.sql.toLowerCase().startsWith('insert into pv_store_api_keys'))!;
    const params = ins.params.map(String);
    // A chave em claro NÃO pode estar entre os parâmetros.
    expect(params).not.toContain(chave);
    expect(params).toContain(crypto.createHash('sha256').update(chave).digest('hex'));
    expect(params).toContain(chave.slice(0, 8));
  });

  it('já havia chave ativa: status `existente`, api_key null — a antiga NÃO é revelada', async () => {
    const { service, consultas } = svc({ chaveAtiva: 'chave-que-ja-existia' });
    const out = await service.provision(entrada() as any);

    expect(out.stores[0].api_key_status).toBe('existente');
    expect(out.stores[0].api_key).toBeNull();
    expect(consultas.some((c) => c.sql.toLowerCase().startsWith('insert into pv_store_api_keys'))).toBe(false);
  });

  it('usuário recém-criado devolve `temporary_password`', async () => {
    const { service } = svc({}, true);
    const out = await service.provision(
      entrada({ stores: [{ trade_name: 'Loja', users: [{ email: 'novo@easysoft.com.br' }] }] }) as any,
    );

    const u = out.stores[0].users[0] as any;
    expect(u.is_new).toBe(true);
    expect(typeof u.temporary_password).toBe('string');
    expect(u.temporary_password.length).toBeGreaterThan(8);
  });

  it('usuário que já existia NÃO devolve senha — não se inventa credencial para quem já tem', async () => {
    const { service } = svc({}, false);
    const out = await service.provision(
      entrada({ stores: [{ trade_name: 'Loja', users: [{ email: 'antigo@easysoft.com.br' }] }] }) as any,
    );

    const u = out.stores[0].users[0] as any;
    expect(u.is_new).toBe(false);
    expect(u.temporary_password).toBeUndefined();
  });
});

describe('TenantsService.provision — normalizações do contrato', () => {
  it('CNPJ com 14 dígitos é reformatado para 00.000.000/0000-00', async () => {
    const { service } = svc();
    const out = await service.provision(entrada({ company: { cnpj: '12345678000199' } }) as any);
    expect(out.company.cnpj).toBe('12.345.678/0001-99');
  });

  it('CNPJ que não tem 14 dígitos passa como veio (não se inventa formatação)', async () => {
    const { service } = svc();
    const out = await service.provision(entrada({ company: { cnpj: '123' } }) as any);
    expect(out.company.cnpj).toBe('123');
  });

  it('sem legacy_store_code, usa max + 1 DENTRO da empresa', async () => {
    const { service, consultas } = svc({ proximoCodigo: 42 });
    const out = await service.provision(entrada() as any);

    expect(out.stores[0].legacy_store_code).toBe(42);
    const max = consultas.find((c) => c.sql.toLowerCase().includes('max(legacy_store_code)'))!;
    expect(max.params).toHaveLength(1); // o recorte é a empresa
  });

  it('com legacy_store_code informado, respeita o valor e nem consulta o max', async () => {
    const { service, consultas } = svc();
    const out = await service.provision(entrada({ stores: [{ legacy_store_code: 9 }] }) as any);

    expect(out.stores[0].legacy_store_code).toBe(9);
    expect(consultas.some((c) => c.sql.toLowerCase().includes('max(legacy_store_code)'))).toBe(false);
  });

  it('usuário sem e-mail é ignorado, não quebra o provisionamento', async () => {
    const { service } = svc();
    const out = await service.provision(
      entrada({ stores: [{ trade_name: 'Loja', users: [{ full_name: 'Sem email' }] }] }) as any,
    );
    expect(out.stores[0].users).toHaveLength(0);
  });
});

describe('TenantsService.provision — atomicidade parcial (documentada, não acidental)', () => {
  it('os usuários são resolvidos no Auth ANTES de a transação abrir', async () => {
    const ordem: string[] = [];
    const auth = {
      client: {
        auth: {
          admin: {
            createUser: vi.fn(async () => {
              ordem.push('auth');
              return { data: { user: { id: USUARIO } }, error: null };
            }),
            generateLink: vi.fn(async () => ({ data: { user: { id: USUARIO } }, error: null })),
          },
        },
      },
    } as unknown as SupabaseAdmin;

    const db = {
      withTransaction: async (fn: any) => {
        ordem.push('transacao');
        return fn({ query: vi.fn(async () => ({ rows: [{ id: EMPRESA, n: 1 }] })) });
      },
    } as unknown as DbService;

    await tenantsService(db, auth).provision(
      entrada({ stores: [{ trade_name: 'Loja', users: [{ email: 'novo@easysoft.com.br' }] }] }) as any,
    );

    // É por isto que um rollback NÃO desfaz o usuário criado no Auth. É seguro para
    // reexecução (a próxima chamada reaproveita o usuário), mas não é "tudo ou nada"
    // de ponta a ponta — e quem mexer aqui precisa saber que está trocando isso.
    expect(ordem).toEqual(['auth', 'transacao']);
  });

  it('a persistência inteira roda dentro de UMA transação', async () => {
    const withTransaction = vi.fn(async (fn: any) =>
      fn({ query: vi.fn(async () => ({ rows: [{ id: EMPRESA, n: 1 }] })) }),
    );
    const db = { withTransaction } as unknown as DbService;

    await tenantsService(db, authFalso(true)).provision(
      entrada({ stores: [{ trade_name: 'A' }, { trade_name: 'B' }] }) as any,
    );

    // Duas lojas, uma transação só — não uma por loja.
    expect(withTransaction).toHaveBeenCalledTimes(1);
  });
});
