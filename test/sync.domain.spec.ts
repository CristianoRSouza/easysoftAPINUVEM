import { describe, expect, it, vi } from 'vitest';
import { SyncService } from '../src/modules/sync/application/sync.service';
import { NIL_UUID, toInboxBatchJson } from '../src/modules/sync/domain/sync-event';
import { SyncRepository } from '../src/modules/sync/infrastructure/sync.repository';
import type { DbService } from '../src/db/db.service';
import type { Env } from '../src/config/env';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const STORE = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';

function fakeDb(result: { rows: unknown[]; rowCount?: number | null } = { rows: [] }) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return result;
    }),
  } as unknown as DbService;
  const svc = new SyncService(new SyncRepository(db, { SYNC_SCHEMA: 'ecb_sync' } as Env));
  return { calls, svc };
}

describe('fila de sync — regras puras e casos de uso', () => {
  describe('toInboxBatchJson', () => {
    const evento = {
      event_id: '00000000-0000-4000-8000-000000000001',
      entity_name: 'nfce.items',
      entity_id: ITEM,
      op: 'U',
      company_id: COMPANY,
      store_id: STORE,
    };

    it('payload ausente vira {} — a coluna jsonb não recebe null', () => {
      expect(JSON.parse(toInboxBatchJson([evento]))).toEqual([{ ...evento, payload: {} }]);
      expect(JSON.parse(toInboxBatchJson([{ ...evento, payload: null }]))[0].payload).toEqual({});
    });

    it('payload presente passa como veio', () => {
      const [doc] = JSON.parse(toInboxBatchJson([{ ...evento, payload: { rtrib_v_item: 48 } }]));
      expect(doc.payload).toEqual({ rtrib_v_item: 48 });
    });

    it('só os campos da fila vão para o banco — campo extra é descartado', () => {
      const comExtra = { ...evento, payload: {}, intruso: 'x' };
      expect(Object.keys(JSON.parse(toInboxBatchJson([comExtra]))[0])).toEqual([
        'event_id', 'entity_name', 'entity_id', 'op', 'payload', 'company_id', 'store_id',
      ]);
    });

    it('lote vazio é uma lista vazia', () => {
      expect(toInboxBatchJson([])).toBe('[]');
    });
  });

  describe('pull da outbox — empresa e loja andam em par', () => {
    it('com as duas: recorte por tenant, aceitando o NIL UUID de broadcast', async () => {
      const { svc, calls } = fakeDb();
      await svc.fetchPendingOutbox(100, COMPANY, STORE);
      expect(calls[0].sql).toContain('FROM ecb_sync.outbox');
      expect(calls[0].sql).toContain('company_id IN ($2::uuid, $4::uuid)');
      expect(calls[0].sql).toContain('store_id   IN ($3::uuid, $4::uuid)');
      expect(calls[0].params).toEqual([100, COMPANY, STORE, NIL_UUID]);
    });

    it('só uma das duas é o mesmo que nenhuma: varredura global', async () => {
      for (const [company, store] of [[COMPANY, undefined], [undefined, STORE], [undefined, undefined]]) {
        const { svc, calls } = fakeDb();
        await svc.fetchPendingOutbox(0, company, store);
        expect(calls[0].sql).not.toContain('company_id IN');
        expect(calls[0].params).toEqual([0]);
      }
    });

    it('nos dois casos a ordem é changed_at, event_id', async () => {
      const { svc, calls } = fakeDb();
      await svc.fetchPendingOutbox(1);
      await svc.fetchPendingOutbox(1, COMPANY, STORE);
      for (const c of calls) expect(c.sql).toContain('ORDER BY changed_at ASC, event_id ASC');
    });
  });

  describe('ack da outbox', () => {
    it('lista vazia não vai ao banco', async () => {
      const { svc, calls } = fakeDb();
      expect(await svc.markOutboxDispatched([])).toEqual({ updated: 0 });
      expect(calls).toHaveLength(0);
    });

    it('só marca o que ainda está pending e devolve quantos mudaram', async () => {
      const { svc, calls } = fakeDb({ rows: [{ event_id: 'a' }], rowCount: 1 });
      expect(await svc.markOutboxDispatched(['a', 'b'])).toEqual({ updated: 1 });
      expect(calls[0].sql).toContain("dispatch_status = 'pending'");
      expect(calls[0].params).toEqual([['a', 'b']]);
    });

    it('sem rowCount do driver, conta as linhas devolvidas', async () => {
      const { svc } = fakeDb({ rows: [{ event_id: 'a' }, { event_id: 'b' }], rowCount: null });
      expect(await svc.markOutboxDispatched(['a', 'b'])).toEqual({ updated: 2 });
    });
  });

  it('SYNC_SCHEMA que não é identificador simples é recusado no boot', () => {
    const db = {} as DbService;
    expect(() => new SyncRepository(db, { SYNC_SCHEMA: 'ecb_sync; drop' } as Env)).toThrow(
      'SYNC_SCHEMA inválido',
    );
  });
});
