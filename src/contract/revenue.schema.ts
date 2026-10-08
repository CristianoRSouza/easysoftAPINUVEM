import { z } from 'zod';

/**
 * Receita aprovada — o painel de faturamento do dashboard.
 *
 * É o relatório mais pesado do produto: oito recortes do mesmo conjunto de transações
 * (por método, por dia, por hora, por totem, top 10 produtos, ano-a-ano, KPIs e a lista
 * recente paginada). Hoje isso é montado **no navegador**, em ~340 linhas de JavaScript,
 * a partir de até 5.000 transações + 5.000 comandas + 20.000 itens baixados.
 *
 * Esses tetos truncam em silêncio: passando deles, o painel mostra número menor que o
 * real sem avisar ninguém. Movendo a agregação para o banco, os tetos deixam de existir —
 * o `sum()` roda sobre tudo, não sobre a primeira fatia que coube na memória do browser.
 *
 * ⚠️ Dois rateios aqui NÃO são somas simples, e mexer neles muda número que o dono da
 * loja usa para decidir:
 *   • **byTotem** — uma transação pode pagar comandas de totens diferentes. O valor é
 *     dividido *igualmente* entre os totens distintos daquela transação (não por consumo).
 *   • **byProductTop10** — o valor da transação é rateado entre os itens *na proporção do
 *     subtotal* de cada um. Por isso a soma dos produtos bate com o total, mesmo com
 *     desconto ou acréscimo na transação.
 */

export const revenueQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  recentOffset: z.coerce.number().int().nonnegative().default(0),
  recentLimit: z.coerce.number().int().min(1).max(200).default(50),
});
export type RevenueQuery = z.infer<typeof revenueQuerySchema>;

/**
 * Os grupos que entram no relatório. Dinheiro e outros ficam de fora, como hoje.
 * `voucher` é um GRUPO, não um valor do banco: soma `meal_voucher` e `food_voucher` (o tipo
 * fiscal importa para a NFC-e, não para o faturamento).
 */
export const REVENUE_METHODS = ['credit', 'debit', 'pix', 'voucher'] as const;
export type RevenueMethod = (typeof REVENUE_METHODS)[number];

const methodTotal = z.object({ amount: z.number(), count: z.number() });

export const revenueReportSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  byMethod: z.object({ credit: methodTotal, debit: methodTotal, pix: methodTotal, voucher: methodTotal }),
  total: methodTotal,
  kpis: z.object({
    averageTicket: z.number(),
    shareCredit: z.number(),
    shareDebit: z.number(),
    sharePix: z.number(),
    shareVoucher: z.number(),
    nfceIssuedCount: z.number(),
  }),
  /** Sempre 24 posições, 0..23 — o gráfico precisa da barra zerada da madrugada. */
  byHour: z.array(
    z.object({
      hour: z.number(),
      label: z.string(),
      credit: z.number(),
      debit: z.number(),
      pix: z.number(),
      voucher: z.number(),
      total: z.number(),
    }),
  ),
  recentApproved: z.array(
    z.object({
      id: z.string(),
      created_at: z.string(),
      payment_method: z.string(),
      amount: z.number(),
    }),
  ),
  recentApprovedMeta: z.object({
    offset: z.number(),
    limit: z.number(),
    hasMore: z.boolean(),
  }),
  byTotem: z.array(z.object({ totem: z.string(), amount: z.number(), count: z.number() })),
  byProductTop10: z.array(
    z.object({
      product: z.string(),
      quantity: z.number(),
      amount: z.number(),
      txCount: z.number(),
    }),
  ),
  byMonthYoY: z.array(
    z.object({
      month: z.string(),
      label: z.string(),
      current: z.number(),
      previous: z.number(),
    }),
  ),
  /** Só os dias COM venda — dia vazio não vira ponto (ao contrário do byHour). */
  byDay: z.array(
    z.object({
      day: z.string(),
      label: z.string(),
      credit: z.number(),
      debit: z.number(),
      pix: z.number(),
      voucher: z.number(),
      total: z.number(),
    }),
  ),
});
export type RevenueReport = z.infer<typeof revenueReportSchema>;
