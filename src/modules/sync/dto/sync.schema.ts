import { z } from 'zod';

/** GET /sync/outbox/pending — filtro por tenant é opcional (broadcast via NIL UUID no service). */
export const outboxPendingQuerySchema = z.object({
  // nonnegative: limit=0 é válido e serve de connectivity check (LIMIT 0 → 0 linhas).
  limit: z.coerce.number().int().nonnegative().max(5000).default(1000),
  companyId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
});
export type OutboxPendingQuery = z.infer<typeof outboxPendingQuerySchema>;

const inboxRowSchema = z.object({
  event_id: z.string().uuid(),
  entity_name: z.string().min(1).max(200),
  entity_id: z.string().uuid(),
  op: z.string().min(1).max(20),
  payload: z.unknown(),
  company_id: z.string().uuid(),
  store_id: z.string().uuid(),
});

/** POST /sync/inbox — lote idempotente (ON CONFLICT event_id DO NOTHING no service). */
export const inboxInsertSchema = z.object({
  origin: z.enum(['local', 'supabase']),
  rows: z.array(inboxRowSchema).max(5000),
});
export type InboxInsertInput = z.infer<typeof inboxInsertSchema>;

/** POST /sync/outbox/dispatched — marca dispatched os event_id ainda pending. */
export const outboxDispatchedSchema = z.object({
  eventIds: z.array(z.string().uuid()).max(5000),
});
export type OutboxDispatchedInput = z.infer<typeof outboxDispatchedSchema>;
