import { toFloat, toInt, toIso } from '../../../common/mapping/coerce';
import { REVENUE_METHODS } from '../../../contract/revenue.schema';
import type {
  RevenueMethod,
  RevenueQuery,
  RevenueReport,
} from '../../../contract/revenue.schema';

/**
 * As regras do relatório de receita que NÃO são SQL: de que valores do banco cada grupo
 * é feito, qual é o período quando a tela não manda um, e como os recortes viram KPIs.
 * Tudo puro — testável sem banco.
 */

/** Valores de `payment_method` que compõem cada grupo do relatório. */
export const DB_METHODS_BY_GROUP: Record<RevenueMethod, readonly string[]> = {
  credit: ['credit'],
  debit: ['debit'],
  pix: ['pix'],
  voucher: ['meal_voucher', 'food_voucher'],
};

const groupOf = (dbMethod: string): RevenueMethod | null =>
  REVENUE_METHODS.find((m) => DB_METHODS_BY_GROUP[m].includes(dbMethod)) ?? null;

export type MethodTotals = RevenueReport['byMethod'];

// ── Linhas, como cada agregação sai do banco (numeric/int8 chegam como string) ──────────

export interface MethodTotalRow {
  payment_method: string;
  amount: string;
  cnt: string;
}
/** Pivô por grupo: uma coluna por método, mais as colunas próprias do recorte. */
export type MethodPivotRow = Record<string, string>;
export interface TotemRow {
  totem: string;
  amount: string;
  cnt: string;
}
export interface ProductRow {
  product: string;
  quantity: string;
  amount: string;
  tx_count: string;
}
export interface MonthRow {
  month: string;
  label: string;
  current_amount: string;
  previous_amount: string;
}
export interface RecentRow {
  id: string;
  created_at: unknown;
  payment_method: string;
  amount: string;
}

// ── Período ─────────────────────────────────────────────────────────────────────────────

/**
 * Período padrão: últimos 30 dias até hoje — o mesmo default da Admin-API da loja.
 * `from > to` não é erro: invertemos. Um intervalo trocado na tela deve mostrar o
 * período, não uma mensagem de erro.
 */
export function resolvePeriod(
  q: Pick<RevenueQuery, 'from' | 'to'>,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = ymd(now);
  const to = q.to ?? today;
  const from = q.from ?? ymd(addDays(q.to ? parseYmd(q.to) : now, -29));
  return from > to ? { from: to, to: from } : { from, to };
}

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

// ── Recortes ────────────────────────────────────────────────────────────────────────────

export function totalsByMethod(rows: MethodTotalRow[]): MethodTotals {
  const out: MethodTotals = {
    credit: { amount: 0, count: 0 },
    debit: { amount: 0, count: 0 },
    pix: { amount: 0, count: 0 },
    voucher: { amount: 0, count: 0 },
  };
  // Acumula (+=): o grupo voucher recebe duas linhas do group by (meal_voucher e food_voucher).
  for (const r of rows) {
    const group = groupOf(r.payment_method);
    if (group) {
      out[group].amount += toFloat(r.amount);
      out[group].count += toInt(r.cnt);
    }
  }
  return out;
}

const methodsOf = (r: MethodPivotRow) => ({
  credit: toFloat(r.credit),
  debit: toFloat(r.debit),
  pix: toFloat(r.pix),
  voucher: toFloat(r.voucher),
});

const withTotal = <T extends Record<RevenueMethod, number>>(r: T) => ({
  ...r,
  total: r.credit + r.debit + r.pix + r.voucher,
});

export const mapByDay = (rows: MethodPivotRow[]): RevenueReport['byDay'] =>
  rows.map((r) => withTotal({ day: r.day, label: r.label, ...methodsOf(r) }));

export const mapByHour = (rows: MethodPivotRow[]): RevenueReport['byHour'] =>
  rows.map((r) => withTotal({ hour: toInt(r.hour), label: r.label, ...methodsOf(r) }));

export const mapByTotem = (rows: TotemRow[]): RevenueReport['byTotem'] =>
  rows.map((r) => ({ totem: r.totem, amount: toFloat(r.amount), count: toInt(r.cnt) }));

export const mapByProduct = (rows: ProductRow[]): RevenueReport['byProductTop10'] =>
  rows.map((r) => ({
    product: r.product,
    quantity: toFloat(r.quantity),
    amount: toFloat(r.amount),
    txCount: toInt(r.tx_count),
  }));

export const mapByMonth = (rows: MonthRow[]): RevenueReport['byMonthYoY'] =>
  rows.map((r) => ({
    month: r.month,
    label: r.label,
    current: toFloat(r.current_amount),
    previous: toFloat(r.previous_amount),
  }));

/**
 * O repositório pede `limit + 1` linhas: a sobra diz se há próxima página **sem** pagar
 * um `count(*)` sobre o período inteiro só para descobrir isso.
 */
export function pageOfRecent(
  rows: RecentRow[],
  limit: number,
): { rows: RevenueReport['recentApproved']; hasMore: boolean } {
  return {
    hasMore: rows.length > limit,
    rows: rows.slice(0, limit).map((r) => ({
      id: String(r.id),
      created_at: toIso(r.created_at),
      payment_method: String(r.payment_method ?? ''),
      amount: toFloat(r.amount),
    })),
  };
}

// ── Totais e KPIs ───────────────────────────────────────────────────────────────────────

export function summarize(
  methods: MethodTotals,
  nfceIssuedCount: number,
): Pick<RevenueReport, 'total' | 'kpis'> {
  const amount = REVENUE_METHODS.reduce((acc, m) => acc + methods[m].amount, 0);
  const count = REVENUE_METHODS.reduce((acc, m) => acc + methods[m].count, 0);
  // Percentual com uma casa; sem faturamento, share é 0 e não NaN (0/0 na tela).
  const share = (part: number) => (amount > 0 ? Math.round((part / amount) * 1000) / 10 : 0);

  return {
    total: { amount, count },
    kpis: {
      averageTicket: count > 0 ? Math.round((amount / count) * 100) / 100 : 0,
      shareCredit: share(methods.credit.amount),
      shareDebit: share(methods.debit.amount),
      sharePix: share(methods.pix.amount),
      shareVoucher: share(methods.voucher.amount),
      nfceIssuedCount,
    },
  };
}
