import { describe, expect, it, vi } from 'vitest';
import { SyncPanelService } from '../src/modules/sync-panel/application/sync-panel.service';
import { SyncPanelRepository } from '../src/modules/sync-panel/infrastructure/sync-panel.repository';
import { SYNC_PANEL_ROUTES, type SyncPanelRoute } from '../src/modules/sync-panel/domain/sync-panel.catalog';
import type { DbService } from '../src/db/db.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const STORE = '33333333-3333-4333-8333-333333333333';

function fakeDb(rows: any[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows };
    }),
  } as unknown as DbService;
  return { db, calls, svc: new SyncPanelService(new SyncPanelRepository(db)) };
}

const rota = (path: string) => SYNC_PANEL_ROUTES.find((r) => r.path === path)!;

describe('SyncPanelService — 17 rotas sobre 17 RPCs', () => {
  describe('catálogo', () => {
    it('as 17 rotas existem, com path e RPC únicos', () => {
      expect(SYNC_PANEL_ROUTES).toHaveLength(17);
      expect(new Set(SYNC_PANEL_ROUTES.map((r) => r.path)).size).toBe(17);
      expect(new Set(SYNC_PANEL_ROUTES.map((r) => r.rpc)).size).toBe(17);
    });

    it('toda RPC do catálogo é cloud_sync_* — nenhuma função solta entrou', () => {
      for (const r of SYNC_PANEL_ROUTES) expect(r.rpc).toMatch(/^cloud_sync_(inbox|outbox)_/);
    });

    it('só as rotas paginadas declaram offset', () => {
      const comOffset = SYNC_PANEL_ROUTES.filter((r) => r.offset).map((r) => r.path);
      expect(comOffset.sort()).toEqual(['inbox/recent-all', 'outbox/recent-all']);
    });
  });

  describe('o tenant vem do guard, não do cliente', () => {
    it('empresa e loja são sempre os dois primeiros parâmetros', async () => {
      const { svc, calls } = fakeDb();
      await svc.call(rota('inbox/summary'), COMPANY, STORE);
      expect(calls[0].params[0]).toBe(COMPANY);
      expect(calls[0].params[1]).toBe(STORE);
    });

    it('todas as 17 passam o tenant — nenhuma esquece', async () => {
      for (const r of SYNC_PANEL_ROUTES) {
        const { svc, calls } = fakeDb();
        await svc.call(r, COMPANY, STORE);
        expect(calls[0].params.slice(0, 2), `rota ${r.path}`).toEqual([COMPANY, STORE]);
      }
    });

    it('loja nula é aceita (visão da empresa inteira)', async () => {
      const { svc, calls } = fakeDb();
      await svc.call(rota('outbox/summary'), COMPANY, null);
      expect(calls[0].params).toEqual([COMPANY, null]);
    });

    it('usa argumentos NOMEADOS — reordenar a RPC quebra em vez de trocar empresa por loja', async () => {
      const { svc, calls } = fakeDb();
      await svc.call(rota('inbox/summary'), COMPANY, STORE);
      // Posicional seria um vazamento SEM erro nenhum se os parâmetros trocassem de ordem.
      expect(calls[0].sql).toContain('p_company_id => $1::uuid');
      expect(calls[0].sql).toContain('p_store_id => $2::uuid');
    });
  });

  describe('limites', () => {
    it('rota com limite usa o padrão do descritor', async () => {
      const { svc, calls } = fakeDb();
      await svc.call(rota('inbox/recent-failures'), COMPANY, STORE);
      expect(calls[0].params[2]).toBe(50);
      expect(calls[0].sql).toContain('p_limit =>');
    });

    it('limite absurdo é cortado em 500 pelo SERVIDOR', async () => {
      const { svc, calls } = fakeDb();
      await svc.call(rota('inbox/recent-failures'), COMPANY, STORE, 999_999);
      expect(calls[0].params[2]).toBe(500);
    });

    it('limite zero ou negativo cai no padrão, não vira consulta sem limite', async () => {
      const { svc, calls } = fakeDb();
      await svc.call(rota('inbox/recent-failures'), COMPANY, STORE, 0);
      expect(calls[0].params[2]).toBe(50);
      await svc.call(rota('inbox/recent-failures'), COMPANY, STORE, -10);
      expect(calls[1].params[2]).toBe(50);
    });

    it('rota SEM limite não recebe p_limit', async () => {
      const { svc, calls } = fakeDb();
      await svc.call(rota('inbox/summary'), COMPANY, STORE, 999);
      expect(calls[0].sql).not.toContain('p_limit');
      expect(calls[0].params).toHaveLength(2);
    });

    it('offset só nas paginadas, e negativo vira 0', async () => {
      const { svc, calls } = fakeDb();
      await svc.call(rota('inbox/recent-all'), COMPANY, STORE, 20, 40);
      expect(calls[0].params).toEqual([COMPANY, STORE, 20, 40]);
      await svc.call(rota('inbox/recent-all'), COMPANY, STORE, 20, -5);
      expect(calls[1].params[3]).toBe(0);
    });
  });

  describe('segurança do nome da função', () => {
    it('RPC fora do catálogo é recusada', async () => {
      const { svc } = fakeDb();
      const forjada = { ...rota('inbox/summary'), rpc: 'pg_sleep' } as SyncPanelRoute;
      await expect(svc.call(forjada, COMPANY, STORE)).rejects.toMatchObject({ status: 500 });
    });

    it('o nome da RPC nunca vem de parâmetro do cliente', async () => {
      const { svc, calls } = fakeDb();
      await svc.call(rota('outbox/backlog'), COMPANY, STORE);
      // A função aparece literal no SQL, vinda do catálogo; os valores vão parametrizados.
      expect(calls[0].sql).toContain('public.cloud_sync_outbox_backlog(');
      expect(calls[0].params.every((p) => p === COMPANY || p === STORE)).toBe(true);
    });
  });

  it('Date vira ISO na resposta', async () => {
    const { svc } = fakeDb([{ ultima: new Date('2026-07-30T12:00:00.000Z'), total: 7 }]);
    const [r] = await svc.call(rota('inbox/backlog'), COMPANY, STORE);
    expect((r as any).ultima).toBe('2026-07-30T12:00:00.000Z');
    expect((r as any).total).toBe(7);
  });
});
