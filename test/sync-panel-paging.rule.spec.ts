import { describe, expect, it, vi } from 'vitest';
import { SyncPanelService } from '../src/modules/sync-panel/application/sync-panel.service';
import {
  SYNC_PANEL_MAX_LIMIT,
  SYNC_PANEL_ROUTES,
  syncPanelRoute,
} from '../src/modules/sync-panel/domain/sync-panel.catalog';
import {
  parseOptionalInt,
  resolveLimit,
  resolveOffset,
} from '../src/modules/sync-panel/domain/sync-panel-paging.rule';
import { SyncPanelRepository } from '../src/modules/sync-panel/infrastructure/sync-panel.repository';
import type { DbService } from '../src/db/db.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const STORE = '33333333-3333-4333-8333-333333333333';

function fakeDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows: [] };
    }),
  } as unknown as DbService;
  return { calls, svc: new SyncPanelService(new SyncPanelRepository(db)) };
}

describe('paginação do painel de sync — da query string ao parâmetro da RPC', () => {
  describe('parseOptionalInt', () => {
    it('ausente ou em branco não é número: undefined', () => {
      expect(parseOptionalInt(undefined)).toBeUndefined();
      expect(parseOptionalInt(null)).toBeUndefined();
      expect(parseOptionalInt('')).toBeUndefined();
      expect(parseOptionalInt('   ')).toBeUndefined();
    });

    it('texto que não começa por número: undefined, nunca NaN', () => {
      expect(parseOptionalInt('abc')).toBeUndefined();
      expect(parseOptionalInt('-')).toBeUndefined();
      expect(parseOptionalInt('NaN')).toBeUndefined();
      expect(parseOptionalInt('Infinity')).toBeUndefined();
    });

    it('inteiro, com sinal e com espaço em volta', () => {
      expect(parseOptionalInt('25')).toBe(25);
      expect(parseOptionalInt(' 7 ')).toBe(7);
      expect(parseOptionalInt('0')).toBe(0);
      expect(parseOptionalInt('-10')).toBe(-10);
      expect(parseOptionalInt('+3')).toBe(3);
    });

    it('herda as tolerâncias do parseInt: corta no primeiro caractere estranho', () => {
      expect(parseOptionalInt('12abc')).toBe(12);
      expect(parseOptionalInt('1.9')).toBe(1);
      expect(parseOptionalInt('1e3')).toBe(1);
      expect(parseOptionalInt('0x10')).toBe(0);
    });

    it('parâmetro repetido chega como lista e vale o primeiro; objeto não vale nada', () => {
      expect(parseOptionalInt(['5', '9'])).toBe(5);
      expect(parseOptionalInt({ a: '5' })).toBeUndefined();
    });

    it('número grande demais para ser finito: undefined', () => {
      expect(parseOptionalInt('9'.repeat(400))).toBeUndefined();
    });
  });

  describe('resolveLimit', () => {
    const rota = { defaultLimit: 50 };

    it('sem limite útil (ausente, zero, negativo, NaN) vale o padrão da rota', () => {
      expect(resolveLimit(rota, undefined)).toBe(50);
      expect(resolveLimit(rota, 0)).toBe(50);
      expect(resolveLimit(rota, -10)).toBe(50);
      expect(resolveLimit(rota, Number.NaN)).toBe(50);
    });

    it('rota sem padrão declarado usa 50', () => {
      expect(resolveLimit({}, undefined)).toBe(50);
    });

    it('limite válido passa; acima do teto é cortado', () => {
      expect(resolveLimit(rota, 20)).toBe(20);
      expect(resolveLimit(rota, SYNC_PANEL_MAX_LIMIT)).toBe(SYNC_PANEL_MAX_LIMIT);
      expect(resolveLimit(rota, 999_999)).toBe(SYNC_PANEL_MAX_LIMIT);
    });

    it('o teto vale também para o padrão da rota', () => {
      expect(resolveLimit({ defaultLimit: 9_000 }, undefined)).toBe(SYNC_PANEL_MAX_LIMIT);
    });
  });

  describe('resolveOffset', () => {
    it('ausente, zero, negativo ou NaN é o começo da lista', () => {
      expect(resolveOffset(undefined)).toBe(0);
      expect(resolveOffset(0)).toBe(0);
      expect(resolveOffset(-5)).toBe(0);
      expect(resolveOffset(Number.NaN)).toBe(0);
    });

    it('positivo passa como veio', () => {
      expect(resolveOffset(40)).toBe(40);
    });
  });

  describe('syncPanelRoute', () => {
    it('todo path do catálogo resolve para o próprio descritor', () => {
      for (const r of SYNC_PANEL_ROUTES) {
        expect(syncPanelRoute(r.path as Parameters<typeof syncPanelRoute>[0])).toBe(r);
      }
    });
  });

  /**
   * A conversão saiu do controller (um `toInt` local + a regra dentro do service). Aqui o
   * caminho novo — `SyncPanelService.run`, com a query crua — é comparado, entrada por
   * entrada, com a conta que o código antigo fazia. Qualquer diferença é mudança de
   * comportamento, não refatoração.
   */
  describe('SyncPanelService.run — mesmo resultado do controller antigo, caso a caso', () => {
    const antigoToInt = (v?: string): number | undefined => {
      if (v == null || String(v).trim() === '') return undefined;
      const n = parseInt(String(v), 10);
      return Number.isFinite(n) ? n : undefined;
    };
    const antigoLimit = (v?: string) => {
      const limit = antigoToInt(v);
      return Math.min(limit && limit > 0 ? limit : 50, 500);
    };
    const antigoOffset = (v?: string) => {
      const offset = antigoToInt(v);
      return offset && offset > 0 ? offset : 0;
    };

    const ENTRADAS: Array<string | undefined> = [
      undefined, '', '   ', 'abc', '-', '0', '-1', '-10', '1', '20', ' 7 ', '+3', '50', '499',
      '500', '501', '999999', '12abc', '1.9', '0.9', '1e3', '0x10', 'NaN', 'Infinity', '٣',
    ];

    it('limit — todas as entradas, na rota que só tem limit', async () => {
      for (const limit of ENTRADAS) {
        const { svc, calls } = fakeDb();
        await svc.run('inbox/recent-failures', COMPANY, STORE, { limit });
        expect(calls[0].sql, `limit=${JSON.stringify(limit)}`).toBe(
          'select * from public.cloud_sync_inbox_recent_failures(' +
            'p_company_id => $1::uuid, p_store_id => $2::uuid, p_limit => $3::int)',
        );
        expect(calls[0].params, `limit=${JSON.stringify(limit)}`).toEqual([
          COMPANY,
          STORE,
          antigoLimit(limit),
        ]);
      }
    });

    it('limit e offset — todas as combinações, na rota paginada', async () => {
      for (const limit of ENTRADAS) {
        for (const offset of ENTRADAS) {
          const { svc, calls } = fakeDb();
          await svc.run('outbox/recent-all', COMPANY, null, { limit, offset });
          expect(calls[0].sql).toBe(
            'select * from public.cloud_sync_outbox_recent_all(' +
              'p_company_id => $1::uuid, p_store_id => $2::uuid, ' +
              'p_limit => $3::int, p_offset => $4::int)',
          );
          expect(
            calls[0].params,
            `limit=${JSON.stringify(limit)} offset=${JSON.stringify(offset)}`,
          ).toEqual([COMPANY, null, antigoLimit(limit), antigoOffset(offset)]);
        }
      }
    });

    it('rota sem paginação ignora limit/offset que o cliente mandar', async () => {
      const { svc, calls } = fakeDb();
      await svc.run('inbox/summary', COMPANY, STORE, { limit: '10', offset: '20' });
      expect(calls[0].sql).toBe(
        'select * from public.cloud_sync_inbox_summary(p_company_id => $1::uuid, p_store_id => $2::uuid)',
      );
      expect(calls[0].params).toEqual([COMPANY, STORE]);
    });

    it('sem query nenhuma: padrão da rota e offset zero', async () => {
      const { svc, calls } = fakeDb();
      await svc.run('inbox/recent-all', COMPANY, STORE);
      expect(calls[0].params).toEqual([COMPANY, STORE, 50, 0]);
    });
  });
});
