import {
  blankToNull,
  nullableIso,
  nullableNumber,
  nullableStr,
  str,
  toFloat,
  toInt,
  toIso,
} from '../../../common/mapping/coerce';
import type {
  DashboardStats,
  Order,
  OrderItem,
  Transaction,
  TransactionsByDay,
} from '../../../contract/operations.schema';
import type { Row } from '../../../db/queryable';

/**
 * Linha do banco → forma do fio. Funções puras: não consultam, não lançam, não dependem
 * do Nest. O que cada campo vira quando está AUSENTE é decisão de contrato e mora aqui.
 */

export function mapOrder(r: Row): Order {
  return {
    id: String(r.id),
    barcode: str(r.barcode),
    customer_name: nullableStr(r.customer_name),
    table_name: str(r.table_name),
    status: r.status != null ? String(r.status) : 'open',
    sync_close_pending: Boolean(r.sync_close_pending),
    sync_close_attempts: toInt(r.sync_close_attempts),
    sync_close_last_error: nullableStr(r.sync_close_last_error),
    sync_close_requested_at: nullableIso(r.sync_close_requested_at),
    sync_closed_to_fb_at: nullableIso(r.sync_closed_to_fb_at),
    totem_name: nullableStr(r.totem_name),
    fb_sale_id: nullableNumber(r.fb_sale_id),
    fb_cash_register_id: nullableNumber(r.fb_cash_register_id),
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
    tef_cancel_fb_sale_already_closed: Boolean(r.tef_cancel_fb_sale_already_closed),
    tef_cancel_fb_sale_count: toInt(r.tef_cancel_fb_sale_count),
    tef_cancel_fb_sale_message: blankToNull(r.tef_cancel_fb_sale_message),
    tef_cancel_fb_sale_transaction_id: nullableStr(r.tef_cancel_fb_sale_transaction_id),
  };
}

export function mapOrderItem(r: Row): OrderItem {
  return {
    id: String(r.id),
    order_id: str(r.order_id),
    product_id: nullableStr(r.product_id),
    product_name: str(r.product_name),
    product_barcode: str(r.product_barcode),
    quantity: toFloat(r.quantity),
    unit_price: toFloat(r.unit_price),
    subtotal: toFloat(r.subtotal),
    origin: r.origin != null ? String(r.origin) : 'system',
    status: r.status != null ? String(r.status) : 'active',
    synced_to_fb: Boolean(r.synced_to_fb),
    fb_id: nullableNumber(r.fb_id),
    unit_name: nullableStr(r.unit_name),
    created_at: toIso(r.created_at),
  };
}

export function mapTransaction(r: Row): Transaction {
  return {
    id: String(r.id),
    order_ids: Array.isArray(r.order_ids) ? r.order_ids.map(String) : [],
    payment_method: r.payment_method != null ? String(r.payment_method) : 'other',
    amount: toFloat(r.amount),
    installments: toInt(r.installments) || 1,
    // Campos de TEF/PIX: string vazia é ausência de dado, não valor — a tela mostraria
    // um chip em branco. Normalizamos para null, como o mapeamento do browser fazia.
    nsu: blankToNull(r.nsu),
    authorization_code: blankToNull(r.authorization_code),
    tef_transaction_id: blankToNull(r.tef_transaction_id),
    status: r.status != null ? String(r.status) : 'pending',
    created_at: toIso(r.created_at),
    tef_result: r.tef_result ?? null,
    pix_qrcode_id: blankToNull(r.pix_qrcode_id),
    pix_status: blankToNull(r.pix_status),
    pix_txid: blankToNull(r.pix_txid),
    pix_e2e_id: blankToNull(r.pix_e2e_id),
    pix_paid_at: blankToNull(nullableIso(r.pix_paid_at)),
    pix_last_poll_at: blankToNull(nullableIso(r.pix_last_poll_at)),
    pix_provider_url: blankToNull(r.pix_provider_url),
  };
}

/** As três contagens do topo do dashboard, como o banco as devolve (`count(*)` é int8 → string). */
export interface DashboardCountsRow {
  active_products: string;
  open_orders: string;
  today_transactions: string;
}

/**
 * Os campos de sync vêm zerados porque `sync_log`/`sync_heartbeat` **não existem no
 * Supabase** — são do PostgreSQL da loja. Devolvê-los nulos é a resposta correta, não
 * uma pendência: é o mesmo que a nuvem já faz hoje.
 */
export function mapDashboardStats(r: DashboardCountsRow | undefined): DashboardStats {
  return {
    activeProducts: toInt(r?.active_products),
    openOrders: toInt(r?.open_orders),
    todayTransactions: toInt(r?.today_transactions),
    recentErrors: 0,
    lastSuccessSync: null,
    serviceHeartbeats: { sync: null, nfce: null, tef: null, syncPgSb: null, pixPixnopdv: null },
  };
}

export interface TransactionsByDayRow {
  day: string;
  total: string;
  amount: string;
}

export const mapTransactionsByDay = (rows: TransactionsByDayRow[]): TransactionsByDay =>
  rows.map((r) => ({ day: r.day, total: toInt(r.total), amount: toFloat(r.amount) }));
