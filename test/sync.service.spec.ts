import { describe, expect, it, vi } from 'vitest';
import { SyncService } from '../src/modules/sync/application/sync.service';
import { SyncRepository } from '../src/modules/sync/infrastructure/sync.repository';
import type { DbService } from '../src/db/db.service';
import type { Env } from '../src/config/env';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const STORE = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';

function fakeDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows: [] };
    }),
  } as unknown as DbService;
  const svc = new SyncService(new SyncRepository(db, { SYNC_SCHEMA: 'ecb_sync' } as Env));
  return { calls, svc };
}

const evento = (event_id: string, op: string, payload: unknown) => ({
  event_id,
  entity_name: 'nfce.items',
  entity_id: ITEM,
  op,
  payload,
  company_id: COMPANY,
  store_id: STORE,
});

describe('SyncService.insertInboxIgnoreDuplicates — ordem do lote', () => {
  // Caso real de 29/09/2026: I (rtrib 0) e U (rtrib 48) da mesma linha no mesmo lote. O I tem o
  // event_id "maior"; com received_at empatado o apply o aplicava por último e zerava o valor.
  const lote = [
    evento('ffffffff-ffff-4fff-8fff-ffffffffffff', 'I', { rtrib_v_item: 0 }),
    evento('00000000-0000-4000-8000-000000000001', 'U', { rtrib_v_item: 48 }),
  ];

  it('grava received_at crescente pela posição no lote, não o default now()', async () => {
    const { calls, svc } = fakeDb();
    await svc.insertInboxIgnoreDuplicates('local', lote);

    const sql = calls[0].sql;
    expect(sql).toMatch(/WITH ORDINALITY AS e\(doc, ord\)/);
    expect(sql).toMatch(/now\(\) \+ e\.ord \* interval '1 microsecond'/);
    expect(sql).toMatch(/store_id, received_at\)/);
  });

  it('manda as linhas na ordem em que chegaram — é essa ordem que vira received_at', async () => {
    const { calls, svc } = fakeDb();
    await svc.insertInboxIgnoreDuplicates('local', lote);

    const enviado = JSON.parse(calls[0].params[0] as string) as Array<{ op: string }>;
    expect(enviado.map((r) => r.op)).toEqual(['I', 'U']);
  });

  it('preserva a idempotência canônica por event_id', async () => {
    const { calls, svc } = fakeDb();
    await svc.insertInboxIgnoreDuplicates('local', lote);
    expect(calls[0].sql).toMatch(/ON CONFLICT \(event_id\) DO NOTHING/);
  });

  it('lote vazio não vai ao banco', async () => {
    const { calls, svc } = fakeDb();
    expect(await svc.insertInboxIgnoreDuplicates('local', [])).toEqual({ received: 0 });
    expect(calls).toHaveLength(0);
  });
});
