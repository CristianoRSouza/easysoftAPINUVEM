/**
 * O evento da fila de sync e as duas regras dele que não são SQL. Tudo puro.
 */

/** NIL UUID = broadcast no routing por tenant da outbox cloud (mesmo do Sync-PG-SB). */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Um evento da fila — a mesma forma na outbox (pull) e na inbox (push). */
export interface SyncEvent {
  event_id: string;
  entity_name: string;
  entity_id: string;
  op: string;
  payload?: unknown;
  company_id: string;
  store_id: string;
}

/**
 * O lote como vai para a inbox: só os campos da fila, NA ORDEM em que chegaram (é essa
 * ordem que vira `received_at` — ver `SyncRepository.insertInboxIgnoreDuplicates`), e
 * `payload` ausente vira `{}`.
 */
export function toInboxBatchJson(rows: readonly SyncEvent[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      event_id: r.event_id,
      entity_name: r.entity_name,
      entity_id: r.entity_id,
      op: r.op,
      payload: r.payload ?? {},
      company_id: r.company_id,
      store_id: r.store_id,
    })),
  );
}
