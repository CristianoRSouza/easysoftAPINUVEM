import { describe, expect, it, vi } from 'vitest';
import { CbsService } from '../src/modules/cbs/application/cbs.service';
import { CbsRepository } from '../src/modules/cbs/infrastructure/cbs.repository';
import { CBS_CATALOG } from '../src/modules/cbs/infrastructure/cbs.catalog';
import type { DbService } from '../src/db/db.service';

function fakeDb(rows: any[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows };
    }),
  } as unknown as DbService;
  return { db, calls, svc: new CbsService(new CbsRepository(db)) };
}

const desc = (key: string) => CBS_CATALOG.find((d) => d.key === key)!;

describe('CbsService — 19 rotas de referência, um caminho de código', () => {
  describe('catálogo', () => {
    it('toda entrada tem chave única, SQL parametrizado e teto', () => {
      const keys = CBS_CATALOG.map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const d of CBS_CATALOG) {
        expect(d.sql).toContain('limit $1');
        expect(d.defaultLimit).toBeGreaterThan(0);
        expect(d.summary.length).toBeGreaterThan(5);
      }
    });

    it('nenhum SQL do catálogo interpola valor — tudo por parâmetro', () => {
      for (const d of CBS_CATALOG) {
        expect(d.sql).not.toMatch(/\$\{/);
      }
    });

    it('chave desconhecida não resolve (o 404 do controller depende disso)', () => {
      const { svc } = fakeDb();
      expect(svc.find('nao-existe')).toBeUndefined();
      expect(svc.find('state')).toBeDefined();
    });
  });

  describe('tetos de linha', () => {
    it('sem limite explícito, usa o padrão do descritor', async () => {
      const { svc, calls } = fakeDb();
      await svc.list(desc('state'));
      expect(calls[0].params[0]).toBe(desc('state').defaultLimit);
    });

    it('limite do cliente é respeitado quando menor', async () => {
      const { svc, calls } = fakeDb();
      await svc.list(desc('state'), 7);
      expect(calls[0].params[0]).toBe(7);
    });

    it('limite absurdo é cortado em 2000 — o teto é do SERVIDOR', async () => {
      const { svc, calls } = fakeDb();
      await svc.list(desc('legal-basis'), 999_999);
      expect(calls[0].params[0]).toBe(2000);
    });

    it('limite zero ou negativo cai no padrão, não vira consulta sem limite', async () => {
      const { svc, calls } = fakeDb();
      await svc.list(desc('state'), 0);
      expect(calls[0].params[0]).toBe(desc('state').defaultLimit);
      await svc.list(desc('state'), -5);
      expect(calls[1].params[0]).toBe(desc('state').defaultLimit);
    });
  });

  describe('filtro opcional de estado', () => {
    it('state-reference-rate recebe o segundo parâmetro', async () => {
      const { svc, calls } = fakeDb();
      await svc.list(desc('state-reference-rate'), 10, 35);
      expect(calls[0].params).toEqual([10, 35]);
    });

    it('sem stateCode, o parâmetro vai null e o SQL neutraliza o filtro', async () => {
      const { svc, calls } = fakeDb();
      await svc.list(desc('state-reference-rate'), 10);
      expect(calls[0].params).toEqual([10, null]);
      expect(calls[0].sql).toContain('$2::int is null');
    });

    it('descritor sem $2 não recebe parâmetro extra', async () => {
      const { svc, calls } = fakeDb();
      await svc.list(desc('state'), 10, 35);
      expect(calls[0].params).toEqual([10]);
    });
  });

  describe('normalização', () => {
    it('aplica as constantes do contrato que não existem na nuvem', async () => {
      const { svc } = fakeDb([{ code: '35', abbreviation: 'SP', name: 'São Paulo' }]);
      const [r] = await svc.list(desc('state'));
      expect(r.raw_json).toBeNull();
      expect(r.code).toBe(35);
    });

    it('campo declarado nullable vira null; os demais viram string vazia', async () => {
      const { svc } = fakeDb([
        { reference_date: null, valid_from: null, valid_to: null, reference_rate: '0.09' },
      ]);
      const [r] = await svc.list(desc('union-reference-rate'));
      expect(r.valid_to).toBeNull();
      expect(r.reference_date).toBe('');
    });

    it('número nullable ausente fica null — 0 seria "isento", que é outra coisa', async () => {
      const { svc } = fakeDb([{ state_code: '35', reference_rate: null, own_rate: null }]);
      const [r] = await svc.list(desc('state-reference-rate'));
      expect(r.state_code).toBe(35);
      expect(r.reference_rate).toBeNull();
    });

    it('booleano é preservado, não vira string', async () => {
      const { svc } = fakeDb([{ cst_code: '000', ind_nfce: true, ind_cte: false }]);
      const [r] = await svc.list(desc('cst-ibscbs-indicator'));
      expect(r.ind_nfce).toBe(true);
      expect(r.ind_cte).toBe(false);
    });

    it('Date vira ISO', async () => {
      const { svc } = fakeDb([{ code: '35', updated_at: new Date('2026-07-30T12:00:00.000Z') }]);
      const [r] = await svc.list(desc('state'));
      expect(r.updated_at).toBe('2026-07-30T12:00:00.000Z');
    });
  });

  describe('municípios', () => {
    it('sempre filtrados por UF, parametrizado', async () => {
      const { svc, calls } = fakeDb();
      await svc.municipalitiesByUf('SP');
      expect(calls[0].params).toEqual(['SP']);
      expect(calls[0].sql).toContain('upper(state_acronym) = upper($1)');
    });

    it('município sem alíquota publicada devolve null, não 0', async () => {
      const { svc } = fakeDb([
        { code: '3550308', name: 'São Paulo', state_abbreviation: 'SP', reference_rate: null },
      ]);
      const [r] = await svc.municipalitiesWithRateByUf('SP');
      expect(r.reference_rate).toBeNull();
      expect(r.own_rate_mun).toBeNull();
      expect(r.municipality_code).toBe(3550308);
    });

    it('devolve `code` como TEXTO — é o campo que a tela lê', () => {
      // A tela faz `{m.code}` e `String(m.code).includes(busca)`. A rota devolvia só
      // `municipality_code`, numérico: a coluna "Código IBGE" ficava vazia e a busca por
      // código não achava nada. Os dois nomes vão juntos, o antigo por compatibilidade.
      return fakeDb([{ code: '3550308', name: 'São Paulo', state_abbreviation: 'SP' }])
        .svc.municipalitiesWithRateByUf('SP')
        .then(([r]) => {
          expect(r.code).toBe('3550308');
          expect(r.state_abbreviation).toBe('SP');
        });
    });

    it('traz TODAS as alíquotas do município, não só a mais recente', async () => {
      // Era um `left join lateral ... limit 1`. A tela filtra por ano e monta uma linha
      // por (município × data de referência): com só a mais recente, escolher 2025 vinha
      // vazio enquanto o Manager antigo mostrava as linhas — sem erro nenhum aparecer.
      const { svc, calls } = fakeDb();
      await svc.municipalitiesWithRateByUf('SP');
      expect(calls[0].sql).not.toContain('limit 1');
      expect(calls[0].sql).toContain('left join public.pb_cbs_municipal_rates');
      expect(calls[0].sql).toContain('order by c.name, r.reference_date desc');
    });
  });

  describe('classificação de UM produto', () => {
    it('filtra pelo código — não devolve a primeira linha do catálogo', async () => {
      // É por isso que a rota existe. A rota genérica só aceita `limit`/`stateCode`:
      // mandar `?code=X` para ela não filtra nada, a resposta vem com as primeiras 300
      // linhas e a tela pega a primeira — exibindo a classificação tributária de OUTRO
      // produto, sem erro nenhum aparecer. Errar dado fiscal calado é pior que tela vazia.
      const { svc, calls } = fakeDb([{ class_code: '011001', description: 'Planos' }]);
      await svc.productFiscalIbsCbs('011001');
      for (const c of calls) {
        expect(c.sql).toContain('where t.class_code = $1');
        expect(c.params).toEqual(['011001']);
      }
    });

    it('código sem correspondência devolve null nos dois, não um objeto vazio', async () => {
      const { svc } = fakeDb([]);
      expect(await svc.productFiscalIbsCbs('ZZZZZZ')).toEqual({ taxClass: null, indicator: null });
    });

    it('reaproveita o SQL do catálogo — o contrato não se bifurca', async () => {
      // Se esta rota tivesse SQL próprio, um conserto de apelido precisaria ser feito em
      // dois lugares, e o segundo seria esquecido.
      const { svc, calls } = fakeDb([{ class_code: 'x' }]);
      await svc.productFiscalIbsCbs('x');
      expect(calls[0].sql).toContain('as class_code');
      expect(calls[0].sql).toContain('pb_cbs_cclasstrib');
      expect(calls[1].sql).toContain('pb_cbs_cclasstrib_ind');
      // o `limit $1` do catálogo virou teto fixo; `$1` agora é o código
      expect(calls[0].sql).not.toContain('limit $1');
    });
  });

  describe('open-dataset-version', () => {
    it('lê pb_cbs_dataset_version e entrega o contrato da loja', async () => {
      const { svc, calls } = fakeDb([
        {
          id: '1',
          dataset_description: 'Alíquotas fixas',
          provider_app_version: '101Publico-SNAPSHOT-b3f75196',
          provider_db_version: 'V0018',
          updated_at: new Date('2026-09-30T00:00:00Z'),
        },
      ]);
      expect(await svc.openDatasetVersion()).toEqual([
        {
          id: 1,
          dataset_description: 'Alíquotas fixas',
          provider_app_version: '101Publico-SNAPSHOT-b3f75196',
          provider_db_version: 'V0018',
          updated_at: '2026-09-30T00:00:00.000Z',
        },
      ]);
      expect(calls[0].sql).toContain('pb_cbs_dataset_version');
    });

    it('banco sem a tabela (42P01) devolve [] em vez de 500', async () => {
      const db = {
        query: vi.fn(async () => {
          throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
        }),
      } as unknown as DbService;
      expect(await new CbsService(new CbsRepository(db)).openDatasetVersion()).toEqual([]);
    });

    it('outro erro de banco não é engolido', async () => {
      const db = {
        query: vi.fn(async () => {
          throw Object.assign(new Error('boom'), { code: '57P01' });
        }),
      } as unknown as DbService;
      await expect(new CbsService(new CbsRepository(db)).openDatasetVersion()).rejects.toThrow('boom');
    });
  });
});
