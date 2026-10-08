import { describe, expect, it, vi } from 'vitest';
import { OperationsService } from '../src/modules/operations/application/operations.service';
import { OperationsRepository } from '../src/modules/operations/infrastructure/operations.repository';
import {
  dashboardStatsSchema,
  orderItemSchema,
  orderSchema,
  transactionSchema,
  transactionsByDaySchema,
} from '../src/contract/operations.schema';
import type { DbService } from '../src/db/db.service';

const STORE = '33333333-3333-4333-8333-333333333333';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const ORDER = '66666666-6666-4666-8666-666666666666';

function fakeDb(rows: any[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows };
    }),
  } as unknown as DbService;
  return { db, calls, svc: new OperationsService(new OperationsRepository(db)) };
}

describe('OperationsService — recorte de tenant, datas e forma do fio', () => {
  describe('o filtro de loja vem sempre primeiro', () => {
    it('orders', async () => {
      const { svc, calls } = fakeDb();
      await svc.listOrders(STORE, {});
      expect(calls[0].sql).toContain('store_id = $1::uuid');
      expect(calls[0].params).toEqual([STORE]);
    });

    it('transactions', async () => {
      const { svc, calls } = fakeDb();
      await svc.listTransactions(STORE, {});
      expect(calls[0].params[0]).toBe(STORE);
    });

    it('order-items por comanda: loja E comanda, nunca só a comanda', async () => {
      const { svc, calls } = fakeDb();
      await svc.listOrderItems(STORE, { orderId: ORDER });
      expect(calls[0].sql).toContain('store_id = $1::uuid');
      expect(calls[0].sql).toContain('order_id = $2::uuid');
      expect(calls[0].params).toEqual([STORE, ORDER]);
    });

    it('order-items por intervalo continua preso à loja', async () => {
      const { svc, calls } = fakeDb();
      await svc.listOrderItems(STORE, { from: '2026-07-01', to: '2026-07-31' });
      expect(calls[0].sql).toContain('oi.store_id = $1::uuid');
      expect(calls[0].params[0]).toBe(STORE);
    });

    it('dashboard: as três contagens numa consulta só, todas presas à loja', async () => {
      const { svc, calls } = fakeDb([
        { active_products: '10', open_orders: '2', today_transactions: '7' },
      ]);
      const out = await svc.dashboardStats(COMPANY, STORE);
      expect(calls).toHaveLength(1);
      expect(calls[0].sql.match(/store_id = \$1::uuid/g)).toHaveLength(3);
      expect(out.activeProducts).toBe(10);
      expect(() => dashboardStatsSchema.parse(out)).not.toThrow();
    });
  });

  describe('recorte por data', () => {
    it('from e to entram parametrizados, por dia civil inclusivo', async () => {
      const { svc, calls } = fakeDb();
      await svc.listOrders(STORE, { from: '2026-07-01', to: '2026-07-31' });
      expect(calls[0].sql).toContain('created_at >= $2::date');
      expect(calls[0].sql).toContain('created_at < ($3::date + 1)');
      expect(calls[0].params).toEqual([STORE, '2026-07-01', '2026-07-31']);
    });

    it('só `from` não inventa `to`', async () => {
      const { svc, calls } = fakeDb();
      await svc.listOrders(STORE, { from: '2026-07-01' });
      expect(calls[0].params).toEqual([STORE, '2026-07-01']);
      expect(calls[0].sql).not.toContain('<= $3');
    });

    it('orderId ganha das datas em order-items (é o caso "abri a comanda")', async () => {
      const { svc, calls } = fakeDb();
      await svc.listOrderItems(STORE, { orderId: ORDER, from: '2026-07-01' });
      expect(calls[0].sql).not.toContain('join');
      expect(calls[0].params).toEqual([STORE, ORDER]);
    });

    it('order-items sem filtro nenhum não faz JOIN à toa', async () => {
      const { svc, calls } = fakeDb();
      await svc.listOrderItems(STORE, {});
      expect(calls[0].sql).not.toContain('join public.vw_command_orders');
    });
  });

  describe('alerta TEF cancelado com venda FB fechada', () => {
    it('deriva das transações canceladas marcadas, presas à mesma loja e às comandas recortadas', async () => {
      const { svc, calls } = fakeDb();
      await svc.listOrders(STORE, { from: '2026-09-01' });
      const sql = calls[0].sql;
      expect(sql).toContain('public.vw_command_transactions t');
      expect(sql).toContain('t.store_id = $1::uuid');
      expect(sql).toContain("t.status = 'cancelled'");
      expect(sql).toContain(`t.tef_result @> '{"tefCancelFbSaleAlreadyClosed": true}'::jsonb`);
      expect(sql).toContain('t.order_ids && array(select id from o)');
      expect(calls[0].params).toEqual([STORE, '2026-09-01']);
    });

    it('comanda com alerta traz os quatro campos e passa no contrato', async () => {
      const { svc } = fakeDb([
        {
          id: ORDER,
          barcode: '3',
          status: 'closed',
          created_at: new Date('2026-09-30T13:11:54.000Z'),
          tef_cancel_fb_sale_already_closed: true,
          tef_cancel_fb_sale_count: 1,
          tef_cancel_fb_sale_message: 'TEF cancelado, mas a venda ja estava fechada no Firebird',
          tef_cancel_fb_sale_transaction_id: '272d6ace-c286-4e07-8245-2d894bbdd96f',
        },
      ]);
      const [o] = await svc.listOrders(STORE, {});
      expect(o.tef_cancel_fb_sale_already_closed).toBe(true);
      expect(o.tef_cancel_fb_sale_count).toBe(1);
      expect(o.tef_cancel_fb_sale_transaction_id).toBe('272d6ace-c286-4e07-8245-2d894bbdd96f');
      expect(() => orderSchema.parse(o)).not.toThrow();
    });

    it('comanda sem alerta vem false/0/null, não undefined', async () => {
      const { svc } = fakeDb([{ id: ORDER, created_at: new Date('2026-09-30T13:11:54.000Z') }]);
      const [o] = await svc.listOrders(STORE, {});
      expect(o.tef_cancel_fb_sale_already_closed).toBe(false);
      expect(o.tef_cancel_fb_sale_count).toBe(0);
      expect(o.tef_cancel_fb_sale_message).toBeNull();
      expect(o.tef_cancel_fb_sale_transaction_id).toBeNull();
    });
  });

  describe('transações', () => {
    it('orderId usa @> no array (aproveita índice GIN, ao contrário de unnest)', async () => {
      const { svc, calls } = fakeDb();
      await svc.listTransactions(STORE, { orderId: ORDER });
      expect(calls[0].sql).toContain('order_ids @> array[$2::uuid]');
      expect(calls[0].params).toEqual([STORE, ORDER]);
    });

    it('orderId e datas convivem, com os índices na ordem certa', async () => {
      const { svc, calls } = fakeDb();
      await svc.listTransactions(STORE, { orderId: ORDER, from: '2026-07-01' });
      expect(calls[0].sql).toContain('order_ids @> array[$2::uuid]');
      expect(calls[0].sql).toContain('created_at >= $3::date');
      expect(calls[0].params).toEqual([STORE, ORDER, '2026-07-01']);
    });

    it('campos de TEF/PIX em branco viram null — chip vazio na tela é pior que ausente', async () => {
      const { svc } = fakeDb([
        {
          id: 't1',
          order_ids: [ORDER],
          payment_method: 'credit',
          amount: '42.90',
          installments: '1',
          nsu: '   ',
          authorization_code: '',
          tef_transaction_id: null,
          status: 'approved',
          created_at: new Date('2026-07-30T12:00:00.000Z'),
          tef_result: { ok: true },
          pix_qrcode_id: '',
          pix_status: null,
          pix_txid: '',
          pix_e2e_id: null,
          pix_paid_at: null,
          pix_last_poll_at: null,
          pix_provider_url: '',
        },
      ]);
      const [t] = await svc.listTransactions(STORE, {});
      expect(t.nsu).toBeNull();
      expect(t.authorization_code).toBeNull();
      expect(t.pix_qrcode_id).toBeNull();
      expect(t.amount).toBe(42.9);
      expect(t.created_at).toBe('2026-07-30T12:00:00.000Z');
      expect(t.tef_result).toEqual({ ok: true });
      expect(() => transactionSchema.parse(t)).not.toThrow();
    });

    it('order_ids ausente vira lista vazia, não null (a tela itera)', async () => {
      const { svc } = fakeDb([{ id: 't1', order_ids: null, amount: null, created_at: null }]);
      const [t] = await svc.listTransactions(STORE, {});
      expect(t.order_ids).toEqual([]);
      expect(t.installments).toBe(1);
      expect(() => transactionSchema.parse(t)).not.toThrow();
    });
  });

  describe('conversões', () => {
    it('comanda: numeric/Date convertidos, nulos respeitando o contrato', async () => {
      const { svc } = fakeDb([
        {
          id: 'o1',
          barcode: null,
          customer_name: null,
          table_name: 'Mesa 4',
          status: null,
          sync_close_pending: null,
          sync_close_attempts: null,
          sync_close_last_error: null,
          sync_close_requested_at: null,
          sync_closed_to_fb_at: null,
          totem_name: null,
          fb_sale_id: null,
          fb_cash_register_id: '17',
          created_at: new Date('2026-07-30T12:00:00.000Z'),
          updated_at: null,
        },
      ]);
      const [o] = await svc.listOrders(STORE, {});
      expect(o.barcode).toBe('');
      expect(o.status).toBe('open');
      expect(o.sync_close_attempts).toBe(0);
      expect(o.fb_sale_id).toBeNull();
      expect(o.fb_cash_register_id).toBe(17);
      expect(o.updated_at).toBe('');
      expect(() => orderSchema.parse(o)).not.toThrow();
    });

    it('item: quantity/subtotal viram número; origin e status têm default', async () => {
      const { svc } = fakeDb([
        {
          id: 'i1',
          order_id: ORDER,
          product_id: null,
          product_name: 'Refri',
          product_barcode: null,
          quantity: '2.000',
          unit_price: '7.50',
          subtotal: '15.00',
          origin: null,
          status: null,
          synced_to_fb: false,
          fb_id: null,
          unit_name: null,
          created_at: new Date('2026-07-30T12:00:00.000Z'),
        },
      ]);
      const [i] = await svc.listOrderItems(STORE, { orderId: ORDER });
      expect(i.quantity).toBe(2);
      expect(i.subtotal).toBe(15);
      expect(i.origin).toBe('system');
      expect(i.status).toBe('active');
      expect(() => orderItemSchema.parse(i)).not.toThrow();
    });
  });

  describe('gráficos', () => {
    it('transactions-by-day usa generate_series — dia sem venda vira barra zerada', async () => {
      const { svc, calls } = fakeDb([{ day: '30/07', total: '0', amount: '0' }]);
      const out = await svc.transactionsByDay(STORE);
      expect(calls[0].sql).toContain('generate_series');
      // LEFT JOIN: o dia existe mesmo sem transação casando.
      expect(calls[0].sql).toContain('left join');
      expect(out[0]).toEqual({ day: '30/07', total: 0, amount: 0 });
      expect(() => transactionsByDaySchema.parse(out)).not.toThrow();
    });

    it('sync-by-hour devolve [] SEM tocar o banco (a tabela não existe no Supabase)', async () => {
      const { svc, calls } = fakeDb();
      await expect(svc.syncByHour()).resolves.toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it('dashboard: campos de sync vêm nulos por desenho, não por falha', async () => {
      const { svc } = fakeDb([{ active_products: '1', open_orders: '0', today_transactions: '0' }]);
      const out = await svc.dashboardStats(COMPANY, STORE);
      expect(out.recentErrors).toBe(0);
      expect(out.lastSuccessSync).toBeNull();
      expect(out.serviceHeartbeats).toEqual({
        sync: null, nfce: null, tef: null, syncPgSb: null, pixPixnopdv: null,
      });
    });
  });
});
