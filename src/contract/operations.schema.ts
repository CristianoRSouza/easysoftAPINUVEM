import { z } from 'zod';

/**
 * Operação — comandas, itens, transações e os números do dashboard.
 *
 * Forma copiada do que a UI já consome (`Order`, `OrderItem`, `Transaction`) e do que
 * a Admin-API local devolve em `/v1/orders`, `/order-items`, `/transactions` e
 * `/dashboard/*`.
 *
 * ── `tef_cancel_fb_sale_*` em `GET /v1/orders` ──
 * Alerta "TEF cancelado · venda FB fechada", derivado das transações canceladas com
 * `tef_result.tefCancelFbSaleAlreadyClosed`. Nasceu só na loja; a nuvem passou a
 * calcular igual (mesma regra). Seguem **opcionais** porque a Admin-API da loja em
 * versões antigas é a outra ponta deste contrato.
 */

const dateFilter = z.object({
  /** `YYYY-MM-DD`. Limite por dia civil no fuso do BANCO (ver nota em operations.repository.ts). */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const ordersQuerySchema = dateFilter;
export type OrdersQuery = z.infer<typeof ordersQuerySchema>;

export const orderSchema = z.object({
  id: z.string(),
  barcode: z.string(),
  customer_name: z.string().nullable(),
  table_name: z.string(),
  status: z.string(),
  sync_close_pending: z.boolean(),
  sync_close_attempts: z.number(),
  sync_close_last_error: z.string().nullable(),
  sync_close_requested_at: z.string().nullable(),
  sync_closed_to_fb_at: z.string().nullable(),
  totem_name: z.string().nullable(),
  fb_sale_id: z.number().nullable(),
  fb_cash_register_id: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  // Alerta de TEF cancelado com venda FB fechada (ver nota no topo).
  tef_cancel_fb_sale_already_closed: z.boolean().optional(),
  tef_cancel_fb_sale_count: z.number().optional(),
  tef_cancel_fb_sale_message: z.string().nullable().optional(),
  tef_cancel_fb_sale_transaction_id: z.string().nullable().optional(),
});
export type Order = z.infer<typeof orderSchema>;

export const orderItemsQuerySchema = dateFilter.extend({
  /** Quando presente, ganha de `from`/`to` — é o caso "abri uma comanda". */
  orderId: z.string().uuid().optional(),
});
export type OrderItemsQuery = z.infer<typeof orderItemsQuerySchema>;

export const orderItemSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  product_id: z.string().nullable(),
  product_name: z.string(),
  product_barcode: z.string(),
  quantity: z.number(),
  unit_price: z.number(),
  subtotal: z.number(),
  origin: z.string(),
  status: z.string(),
  synced_to_fb: z.boolean(),
  fb_id: z.number().nullable(),
  unit_name: z.string().nullable(),
  created_at: z.string(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const transactionsQuerySchema = dateFilter.extend({
  /** Transações que contenham esta comanda em `order_ids` (a coluna é um array). */
  orderId: z.string().uuid().optional(),
});
export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>;

export const transactionSchema = z.object({
  id: z.string(),
  order_ids: z.array(z.string()),
  payment_method: z.string(),
  amount: z.number(),
  installments: z.number(),
  nsu: z.string().nullable(),
  authorization_code: z.string().nullable(),
  tef_transaction_id: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
  /** Snapshot cru do TEF — opaco de propósito; a tela sabe o que procurar. */
  tef_result: z.unknown().nullable(),
  pix_qrcode_id: z.string().nullable(),
  pix_status: z.string().nullable(),
  pix_txid: z.string().nullable(),
  pix_e2e_id: z.string().nullable(),
  pix_paid_at: z.string().nullable(),
  pix_last_poll_at: z.string().nullable(),
  pix_provider_url: z.string().nullable(),
});
export type Transaction = z.infer<typeof transactionSchema>;

/**
 * Números do topo do dashboard.
 *
 * `recentErrors`, `lastSuccessSync` e `serviceHeartbeats` vêm SEMPRE zerados/nulos na
 * nuvem — e isso não é bug nem pendência: `sync_log` e `sync_heartbeat` **não existem no
 * Supabase**, são tabelas do PostgreSQL da loja. Só a implementação local preenche.
 * Mantemos os campos no contrato para a tela não precisar de dois formatos.
 */
export const dashboardStatsSchema = z.object({
  activeProducts: z.number(),
  openOrders: z.number(),
  todayTransactions: z.number(),
  recentErrors: z.number(),
  lastSuccessSync: z.unknown().nullable(),
  serviceHeartbeats: z.object({
    sync: z.string().nullable(),
    nfce: z.string().nullable(),
    tef: z.string().nullable(),
    syncPgSb: z.string().nullable(),
    pixPixnopdv: z.string().nullable(),
  }),
});
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

export const transactionsByDaySchema = z.array(
  z.object({
    /** Rótulo `DD/MM` — é o que o gráfico mostra no eixo. */
    day: z.string(),
    total: z.number(),
    amount: z.number(),
  }),
);
export type TransactionsByDay = z.infer<typeof transactionsByDaySchema>;

export const syncByHourSchema = z.array(
  z.object({ hour: z.string(), ok: z.number(), error: z.number() }),
);
export type SyncByHour = z.infer<typeof syncByHourSchema>;
