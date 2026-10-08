import { Injectable } from '@nestjs/common';
import { REVENUE_METHODS } from '../../../contract/revenue.schema';
import type { RevenueMethod } from '../../../contract/revenue.schema';
import { DbService } from '../../../db/db.service';
import {
  DB_METHODS_BY_GROUP,
  type MethodPivotRow,
  type MethodTotalRow,
  type MonthRow,
  type ProductRow,
  type RecentRow,
  type TotemRow,
} from '../domain/revenue-report';

const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(',');

/**
 * Filtro comum a TODOS os recortes — mudar aqui muda o relatório inteiro, de propósito.
 *
 * `::text` é obrigatório: com o enum, um literal que ainda não existe nele (meal_voucher antes
 * da migração da nuvem) derruba a consulta inteira com 22P02 — conferido em homolog 28/09/2026.
 */
const APPROVED = `status = 'approved' and payment_method::text in (${inList(
  REVENUE_METHODS.flatMap((m) => DB_METHODS_BY_GROUP[m]),
)})`;
/**
 * Período como INTERVALO sobre a coluna crua (de `$2 00:00` até antes de `$3 + 1 dia`), e
 * não `created_at::date between`. Mesmas linhas; a diferença é que sem o cast o Postgres
 * usa o índice `(store_id, created_at)` e abre só as partições do período — ver a nota do
 * `dateWhere` em `operations.repository.ts`.
 */
const PERIOD = `created_at >= $2::date and created_at < ($3::date + 1)`;

/** Os mesmos dois filtros, qualificados pelo alias `t` — para os recortes com JOIN. */
const APPROVED_T = APPROVED.replace(/\b(status|payment_method)\b/g, 't.$1');
const PERIOD_T = PERIOD.replace(/\bcreated_at\b/g, 't.created_at');

const MAX_TOTEMS = 12;
const MAX_PRODUCTS = 10;

/** Loja + período já resolvido. Vira `[$1, $2, $3]` em todas as consultas. */
export interface RevenueScope {
  storeId: string;
  from: string;
  to: string;
}

const paramsOf = (s: RevenueScope): unknown[] => [s.storeId, s.from, s.to];

/**
 * Receita aprovada — oito recortes do mesmo conjunto de transações.
 *
 * Cada recorte é uma agregação no banco, em vez de uma varredura em JavaScript sobre
 * dados baixados. Além de rápido, isso remove os tetos que hoje truncam em silêncio
 * (5.000 transações / 20.000 itens no browser): o `sum()` roda sobre o período inteiro.
 */
@Injectable()
export class RevenueRepository {
  constructor(private readonly db: DbService) {}

  async totalsByMethod(scope: RevenueScope): Promise<MethodTotalRow[]> {
    const { rows } = await this.db.query<MethodTotalRow>(
      `select payment_method::text as payment_method,
              coalesce(sum(amount), 0) as amount,
              count(*)                 as cnt
         from public.vw_command_transactions
        where store_id = $1::uuid and ${APPROVED} and ${PERIOD}
        group by payment_method`,
      paramsOf(scope),
    );
    return rows;
  }

  /** Só dias COM venda — é o comportamento de hoje; dia vazio não vira ponto. */
  async byDay(scope: RevenueScope): Promise<MethodPivotRow[]> {
    const { rows } = await this.db.query<MethodPivotRow>(
      `select created_at::date::text            as day,
              to_char(created_at::date, 'DD/MM') as label,
              ${sumIf('credit')}, ${sumIf('debit')}, ${sumIf('pix')}, ${sumIf('voucher')}
         from public.vw_command_transactions
        where store_id = $1::uuid and ${APPROVED} and ${PERIOD}
        group by created_at::date
        order by created_at::date`,
      paramsOf(scope),
    );
    return rows;
  }

  /** SEMPRE 24 posições: o `generate_series` garante a barra zerada da madrugada. */
  async byHour(scope: RevenueScope): Promise<MethodPivotRow[]> {
    const { rows } = await this.db.query<MethodPivotRow>(
      `with horas as (select generate_series(0, 23) as h)
       select horas.h::text                                    as hour,
              lpad(horas.h::text, 2, '0') || 'h'                as label,
              ${sumIf('credit', 't')}, ${sumIf('debit', 't')}, ${sumIf('pix', 't')}, ${sumIf('voucher', 't')}
         from horas
         left join public.vw_command_transactions t
                on t.store_id = $1::uuid and ${APPROVED_T}
               and ${PERIOD_T}
               and extract(hour from t.created_at) = horas.h
        group by horas.h
        order by horas.h`,
      paramsOf(scope),
    );
    return rows;
  }

  /**
   * Rateio por totem: uma transação pode pagar comandas de totens diferentes, e o valor
   * é dividido **igualmente** entre os totens distintos dela (não por consumo).
   *
   * O `distinct` antes da divisão é o que impede contar duas vezes quando a transação tem
   * duas comandas do MESMO totem — sem ele, o totem receberia o dobro do que vendeu.
   */
  async byTotem(scope: RevenueScope): Promise<TotemRow[]> {
    const { rows } = await this.db.query<TotemRow>(
      `with tx as (
         select id, amount, order_ids
           from public.vw_command_transactions
          where store_id = $1::uuid and ${APPROVED} and ${PERIOD}
       ),
       tx_totem as (
         select distinct tx.id, tx.amount,
                coalesce(nullif(trim(o.totem_name), ''), 'Sem totem') as totem
           from tx
           left join lateral unnest(tx.order_ids) as oid(order_id) on true
           left join public.vw_command_orders o
                  on o.id = oid.order_id and o.store_id = $1::uuid
       ),
       quantos as (select id, count(*)::numeric as n from tx_totem group by id)
       select tt.totem,
              coalesce(sum(tt.amount / nullif(q.n, 0)), 0) as amount,
              count(distinct tt.id)                        as cnt
         from tx_totem tt
         join quantos q on q.id = tt.id
        group by tt.totem
        order by 2 desc
        limit ${MAX_TOTEMS}`,
      paramsOf(scope),
    );
    return rows;
  }

  /**
   * Top 10 produtos. O valor da transação é rateado entre os itens **na proporção do
   * subtotal** de cada um — por isso a soma dos produtos bate com o faturamento mesmo
   * havendo desconto ou acréscimo na transação.
   *
   * Item cancelado fica de fora do rateio E do denominador: incluí-lo no denominador
   * encolheria a fatia de todos os outros itens da mesma comanda.
   */
  async byProductTop10(scope: RevenueScope): Promise<ProductRow[]> {
    const { rows } = await this.db.query<ProductRow>(
      `with tx as (
         select id, amount, order_ids
           from public.vw_command_transactions
          where store_id = $1::uuid and ${APPROVED} and ${PERIOD}
       ),
       itens as (
         select tx.id as tx_id,
                tx.amount as tx_amount,
                coalesce(nullif(trim(oi.product_name), ''), 'Produto sem nome') as product,
                coalesce(oi.quantity, 0)::numeric as quantity,
                coalesce(oi.subtotal, 0)::numeric as subtotal
           from tx
           join lateral unnest(tx.order_ids) as oid(order_id) on true
           join public.vw_command_order_items oi
                  on oi.order_id = oid.order_id and oi.store_id = $1::uuid
          where coalesce(lower(oi.status::text), '') <> 'cancelled'
       ),
       base as (select tx_id, sum(subtotal) as subtotal_tx from itens group by tx_id)
       select i.product,
              coalesce(sum(i.quantity), 0)                                          as quantity,
              coalesce(sum(i.tx_amount * (i.subtotal / nullif(b.subtotal_tx, 0))), 0) as amount,
              count(distinct i.tx_id)                                               as tx_count
         from itens i
         join base b on b.tx_id = i.tx_id
        group by i.product
        order by 2 desc, 3 desc
        limit ${MAX_PRODUCTS}`,
      paramsOf(scope),
    );
    return rows;
  }

  /**
   * Ano-a-ano. Cobre TODOS os meses do período (`generate_series`), inclusive os sem
   * venda — um mês sumindo do gráfico seria lido como "não houve mês", não "não houve
   * venda". O ano anterior é deslocado +1 ano para casar com o mês corrente.
   */
  async byMonthYoY(scope: RevenueScope): Promise<MonthRow[]> {
    const { rows } = await this.db.query<MonthRow>(
      `with meses as (
         select generate_series(date_trunc('month', $2::date),
                                date_trunc('month', $3::date),
                                interval '1 month')::date as m
       ),
       atual as (
         select date_trunc('month', created_at)::date as m, coalesce(sum(amount), 0) as amount
           from public.vw_command_transactions
          where store_id = $1::uuid and ${APPROVED} and ${PERIOD}
          group by 1
       ),
       anterior as (
         select (date_trunc('month', created_at) + interval '1 year')::date as m,
                coalesce(sum(amount), 0) as amount
           from public.vw_command_transactions
          where store_id = $1::uuid and ${APPROVED}
            and created_at >= ($2::date - interval '1 year')
            and created_at <  ($3::date - interval '1 year' + interval '1 day')
          group by 1
       )
       select to_char(meses.m, 'YYYY-MM')        as month,
              to_char(meses.m, 'MM/YY')          as label,
              coalesce(a.amount, 0)              as current_amount,
              coalesce(p.amount, 0)              as previous_amount
         from meses
         left join atual    a on a.m = meses.m
         left join anterior p on p.m = meses.m
        order by meses.m`,
      paramsOf(scope),
    );
    return rows;
  }

  /** Notas ligadas às transações aprovadas do período. `manual_review`/`unusable` não contam. */
  async countNfceIssued(scope: RevenueScope): Promise<string | undefined> {
    const { rows } = await this.db.query<{ c: string }>(
      `select count(*) as c
         from public.vw_nfce_notes n
         join public.vw_command_transactions t
              on t.id = n.transaction_id and t.store_id = $1::uuid
        where n.store_id = $1::uuid
          and ${APPROVED_T}
          and ${PERIOD_T}
          and coalesce(lower(n.status::text), '') not in ('manual_review', 'unusable')`,
      paramsOf(scope),
    );
    return rows[0]?.c;
  }

  /** Transações aprovadas mais recentes. Quem pagina (e pede a linha de sobra) é o caso de uso. */
  async findRecentApproved(scope: RevenueScope, limit: number, offset: number): Promise<RecentRow[]> {
    const { rows } = await this.db.query<RecentRow>(
      `select id::text, created_at, payment_method::text, amount
         from public.vw_command_transactions
        where store_id = $1::uuid and ${APPROVED} and ${PERIOD}
        order by created_at desc
        limit $4::int offset $5::int`,
      [...paramsOf(scope), limit, offset],
    );
    return rows;
  }
}

/** `sum(amount) filter (where payment_method in (...))` — o pivô por grupo. */
function sumIf(method: RevenueMethod, alias?: string): string {
  const col = alias ? `${alias}.` : '';
  const values = inList(DB_METHODS_BY_GROUP[method]);
  return `coalesce(sum(${col}amount) filter (where ${col}payment_method::text in (${values})), 0) as ${method}`;
}
