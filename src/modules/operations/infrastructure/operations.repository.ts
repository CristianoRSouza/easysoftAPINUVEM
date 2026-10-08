import { Injectable } from '@nestjs/common';
import type {
  OrderItemsQuery,
  OrdersQuery,
  TransactionsQuery,
} from '../../../contract/operations.schema';
import { DbService } from '../../../db/db.service';
import type { Row } from '../../../db/queryable';
import type { DashboardCountsRow, TransactionsByDayRow } from '../domain/operations.mapper';

const MAX_ORDERS = 1000;
const MAX_ITEMS = 5000;
const MAX_TRANSACTIONS = 1000;

const ORDER_COLUMNS = `
  id, barcode, customer_name, table_name, status, sync_close_pending,
  sync_close_attempts, sync_close_last_error, sync_close_requested_at,
  sync_closed_to_fb_at, totem_name, fb_sale_id, fb_cash_register_id,
  created_at, updated_at`;

const ORDER_ITEM_COLUMNS = `
  id, order_id, product_id, product_name, product_barcode, quantity, unit_price,
  subtotal, origin, status, synced_to_fb, fb_id, unit_name, created_at`;

const TRANSACTION_COLUMNS = `
  id, order_ids, payment_method, amount, installments, nsu, authorization_code,
  tef_transaction_id, status, created_at, tef_result, pix_qrcode_id, pix_status,
  pix_txid, pix_e2e_id, pix_paid_at, pix_last_poll_at, pix_provider_url`;

/**
 * Leituras de operação no Supabase. Toda consulta começa por `store_id = $1` — o role
 * desta API tem `BYPASSRLS`, então o recorte de loja é o WHERE, não a RLS.
 *
 * ── Nota de FUSO (mudança de comportamento, pequena mas real) ──────────────────
 * No browser, `from`/`to` viravam meia-noite **no fuso de quem estava olhando a tela**.
 * Aqui viram o dia civil inteiro no fuso do BANCO (de `from 00:00` até antes de
 * `to + 1 dia`) — exatamente o que a Admin-API da loja sempre fez. Isso é o que faz as duas
 * implementações responderem igual; o efeito colateral é que um usuário em outro fuso
 * pode ver uma transação da virada cair no dia vizinho. Preferimos as duas pontas
 * concordando entre si a cada uma concordar com o relógio de quem abriu o navegador.
 */
@Injectable()
export class OperationsRepository {
  constructor(private readonly db: DbService) {}

  /**
   * Comandas + o alerta "TEF cancelado · venda FB fechada" (`tef_cancel_fb_sale_*`).
   *
   * O alerta não é coluna: é derivado das transações CANCELADAS que o Totem marcou com
   * `tef_result.tefCancelFbSaleAlreadyClosed` — o mesmo cálculo da Admin-API da loja
   * (`GET /v1/orders`). Sem isso a nuvem mostrava a comanda como fechada normal, embora
   * o dado já estivesse aqui.
   *
   * As comandas são recortadas primeiro (CTE `o`) e o alerta só olha transações que
   * tocam essas comandas (`&&` no array, índice GIN). O `distinct` no unnest mantém a
   * contagem da loja: id repetido em `order_ids` conta uma vez por comanda.
   */
  async findOrders(storeId: string, q: OrdersQuery): Promise<Row[]> {
    const { where, params } = dateWhere('created_at', q, ['store_id = $1::uuid'], [storeId]);
    const { rows } = await this.db.query<Row>(
      `with o as (
         select ${ORDER_COLUMNS}
           from public.vw_command_orders
          where ${where}
          order by created_at desc
          limit ${MAX_ORDERS}
       ), tef_alerta as (
         select d.oid as order_id,
                count(*)::int as alert_count,
                (array_agg(t.tef_result->>'tefCancelAdminMessage' order by t.created_at desc))[1] as last_message,
                (array_agg(t.id::text order by t.created_at desc))[1] as last_transaction_id
           from public.vw_command_transactions t
          cross join lateral (select distinct u.oid from unnest(t.order_ids) as u(oid)) d
          where t.store_id = $1::uuid
            and t.status = 'cancelled'
            and t.tef_result @> '{"tefCancelFbSaleAlreadyClosed": true}'::jsonb
            and t.order_ids && array(select id from o)
          group by d.oid
       )
       select o.*,
              coalesce(a.alert_count, 0) > 0 as tef_cancel_fb_sale_already_closed,
              coalesce(a.alert_count, 0) as tef_cancel_fb_sale_count,
              a.last_message as tef_cancel_fb_sale_message,
              a.last_transaction_id as tef_cancel_fb_sale_transaction_id
         from o
         left join tef_alerta a on a.order_id = o.id
        order by o.created_at desc`,
      params,
    );
    return rows;
  }

  /**
   * Itens de comanda. Com `orderId`, é uma comanda só. Com intervalo de datas, o
   * recorte vem de um JOIN com as comandas — **uma** consulta.
   *
   * No browser isso eram até 21 idas ao Supabase: uma para buscar 3000 ids de comanda e
   * mais uma a cada 150 ids, com o merge e a reordenação feitos em JavaScript. Era o
   * caso mais caro do modo nuvem, e some aqui.
   */
  async findOrderItems(storeId: string, q: OrderItemsQuery): Promise<Row[]> {
    if (q.orderId) {
      const { rows } = await this.db.query<Row>(
        `select ${ORDER_ITEM_COLUMNS}
           from public.vw_command_order_items
          where store_id = $1::uuid and order_id = $2::uuid
          order by created_at
          limit ${MAX_ITEMS}`,
        [storeId, q.orderId],
      );
      return rows;
    }

    if (!q.from && !q.to) {
      const { rows } = await this.db.query<Row>(
        `select ${ORDER_ITEM_COLUMNS}
           from public.vw_command_order_items
          where store_id = $1::uuid
          order by created_at
          limit ${MAX_ITEMS}`,
        [storeId],
      );
      return rows;
    }

    const { where, params } = dateWhere('o.created_at', q, ['oi.store_id = $1::uuid'], [storeId]);
    const { rows } = await this.db.query<Row>(
      `select ${prefix(ORDER_ITEM_COLUMNS, 'oi')}
         from public.vw_command_order_items oi
         join public.vw_command_orders o on o.id = oi.order_id
        where ${where}
        order by oi.created_at
        limit ${MAX_ITEMS}`,
      params,
    );
    return rows;
  }

  async findTransactions(storeId: string, q: TransactionsQuery): Promise<Row[]> {
    const conditions = ['store_id = $1::uuid'];
    const baseParams: unknown[] = [storeId];
    if (q.orderId) {
      // `order_ids` é array: `@>` usa índice GIN, ao contrário de unnest+igualdade.
      baseParams.push(q.orderId);
      conditions.push(`order_ids @> array[$${baseParams.length}::uuid]`);
    }
    const { where, params } = dateWhere('created_at', q, conditions, baseParams);
    const { rows } = await this.db.query<Row>(
      `select ${TRANSACTION_COLUMNS}
         from public.vw_command_transactions
        where ${where}
        order by created_at desc
        limit ${MAX_TRANSACTIONS}`,
      params,
    );
    return rows;
  }

  /**
   * Três contagens numa consulta só. No browser eram três chamadas paralelas ao
   * PostgREST com `head: true`.
   *
   * A contagem de produtos leva a EMPRESA além da loja: `pv_products` só tem índice por
   * `company_id`, e sem ela esta contagem varria a tabela inteira (265 ms → 26 ms, medido
   * em produção). Ver a nota em `catalog.repository.ts`.
   */
  async countDashboard(
    companyId: string,
    storeId: string,
  ): Promise<DashboardCountsRow | undefined> {
    const { rows } = await this.db.query<DashboardCountsRow>(
      `select
         (select count(*) from public.pv_products
           where store_id = $1::uuid and company_id = $2::uuid
             and is_active = true)                                      as active_products,
         (select count(*) from public.vw_command_orders
           where store_id = $1::uuid and status = 'open')               as open_orders,
         (select count(*) from public.vw_command_transactions
           where store_id = $1::uuid and created_at >= current_date)    as today_transactions`,
      [storeId, companyId],
    );
    return rows[0];
  }

  /**
   * Transações por dia, últimos 7 dias.
   *
   * O `generate_series` garante os 7 dias mesmo sem venda — o gráfico precisa da barra
   * zerada, senão o eixo "pula" o dia parado e dá a impressão de que ele não existiu.
   * No browser isto baixava **até 20.000 linhas** para somar no JavaScript.
   */
  async sumTransactionsByDay(storeId: string): Promise<TransactionsByDayRow[]> {
    const { rows } = await this.db.query<TransactionsByDayRow>(
      `with dias as (
         select generate_series(current_date - interval '6 days', current_date, interval '1 day')::date as d
       )
       select to_char(dias.d, 'DD/MM')                as day,
              count(t.id)                             as total,
              coalesce(sum(t.amount), 0)              as amount
         from dias
         left join public.vw_command_transactions t
                on t.store_id = $1::uuid
               and t.created_at >= dias.d and t.created_at < dias.d + 1
        group by dias.d
        order by dias.d`,
      [storeId],
    );
    return rows;
  }
}

/**
 * Monta o WHERE com o recorte de data por dia civil, preservando os params já usados.
 *
 * O recorte é um INTERVALO sobre a coluna crua — `col >= from` e `col < to + 1 dia` —, e
 * não `col::date between from and to`. As duas formas devolvem as mesmas linhas (o `date`
 * vira meia-noite no fuso da sessão, o mesmo fuso que o `::date` usaria), mas o cast na
 * coluna esconde dela o índice `(store_id, created_at)` e o corte de partições: a tabela é
 * particionada por `created_at`, e com o cast o Postgres abria as 12 partições para ler
 * uma semana. Medido em produção: 117 blocos lidos → 2.
 */
function dateWhere(
  column: string,
  q: { from?: string; to?: string },
  conditions: string[],
  params: unknown[],
): { where: string; params: unknown[] } {
  const out = [...conditions];
  const p = [...params];
  if (q.from) {
    p.push(q.from);
    out.push(`${column} >= $${p.length}::date`);
  }
  if (q.to) {
    p.push(q.to);
    out.push(`${column} < ($${p.length}::date + 1)`);
  }
  return { where: out.join(' and '), params: p };
}

/** `a, b` -> `oi.a, oi.b` — evita ambiguidade quando há JOIN. */
function prefix(columns: string, alias: string): string {
  return columns
    .split(',')
    .map((c) => `${alias}.${c.trim()}`)
    .join(', ');
}
