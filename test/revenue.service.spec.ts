import { describe, expect, it, vi } from 'vitest';
import { RevenueService } from '../src/modules/operations/application/revenue.service';
import { RevenueRepository } from '../src/modules/operations/infrastructure/revenue.repository';
import { revenueReportSchema } from '../src/contract/revenue.schema';
import type { DbService } from '../src/db/db.service';

const STORE = '33333333-3333-4333-8333-333333333333';

const BASE_QUERY = { recentOffset: 0, recentLimit: 50 };

/**
 * Cada agregação vira uma consulta; devolvemos a resposta conforme o texto do SQL, para
 * o teste não depender da ORDEM em que o Promise.all dispara.
 */
function fakeDb(byShape: Array<{ match: RegExp; rows: any[] }> = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      const hit = byShape.find((s) => s.match.test(sql));
      return { rows: hit ? hit.rows : [] };
    }),
  } as unknown as DbService;
  return { db, calls, svc: new RevenueService(new RevenueRepository(db)) };
}

const sqlFor = (calls: Array<{ sql: string; params: unknown[] }>, re: RegExp) =>
  calls.find((c) => re.test(c.sql));

describe('RevenueService — o relatório mais pesado, agora agregado no banco', () => {
  describe('período', () => {
    it('sem datas: últimos 30 dias até hoje', async () => {
      const { svc } = fakeDb();
      const out = await svc.report(STORE, { ...BASE_QUERY });
      const dias =
        (new Date(out.period.to).getTime() - new Date(out.period.from).getTime()) / 86_400_000;
      expect(Math.round(dias)).toBe(29);
    });

    it('só `from`: `to` vira hoje', async () => {
      const { svc } = fakeDb();
      const out = await svc.report(STORE, { ...BASE_QUERY, from: '2026-01-01' });
      expect(out.period.from).toBe('2026-01-01');
      expect(out.period.to).not.toBe('');
    });

    it('from > to é INVERTIDO, não recusado (intervalo trocado na tela)', async () => {
      const { svc } = fakeDb();
      const out = await svc.report(STORE, { ...BASE_QUERY, from: '2026-07-31', to: '2026-07-01' });
      expect(out.period).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    });

    it('a loja e o período vão parametrizados em toda agregação', async () => {
      const { svc, calls } = fakeDb();
      await svc.report(STORE, { ...BASE_QUERY, from: '2026-07-01', to: '2026-07-31' });
      expect(calls.length).toBeGreaterThanOrEqual(8);
      for (const c of calls) {
        expect(c.params[0]).toBe(STORE);
        expect(c.params[1]).toBe('2026-07-01');
        expect(c.params[2]).toBe('2026-07-31');
        expect(c.sql).toContain('store_id = $1::uuid');
      }
    });

    it('todo recorte filtra por aprovado + credit/debit/pix/voucher', async () => {
      const { svc, calls } = fakeDb();
      await svc.report(STORE, { ...BASE_QUERY });
      for (const c of calls) {
        expect(c.sql).toMatch(/status = 'approved'|t\.status = 'approved'/);
        expect(c.sql).toMatch(/payment_method::text in \('credit','debit','pix','meal_voucher','food_voucher'\)/);
      }
    });
  });

  describe('totais e KPIs', () => {
    it('soma os três métodos e calcula ticket médio e shares', async () => {
      const { svc } = fakeDb([
        {
          match: /group by payment_method/,
          rows: [
            { payment_method: 'credit', amount: '600.00', cnt: '6' },
            { payment_method: 'pix', amount: '400.00', cnt: '4' },
          ],
        },
      ]);
      const out = await svc.report(STORE, { ...BASE_QUERY });
      expect(out.total).toEqual({ amount: 1000, count: 10 });
      expect(out.byMethod.debit).toEqual({ amount: 0, count: 0 });
      expect(out.kpis.averageTicket).toBe(100);
      expect(out.kpis.shareCredit).toBe(60);
      expect(out.kpis.sharePix).toBe(40);
      expect(out.kpis.shareDebit).toBe(0);
    });

    it('sem faturamento, share é 0 e não NaN (0/0 apareceria na tela)', async () => {
      const { svc } = fakeDb();
      const out = await svc.report(STORE, { ...BASE_QUERY });
      expect(out.kpis.shareCredit).toBe(0);
      expect(out.kpis.averageTicket).toBe(0);
      expect(Number.isNaN(out.kpis.shareCredit)).toBe(false);
    });

    it('método desconhecido no banco não entra no total', async () => {
      const { svc } = fakeDb([
        {
          match: /group by payment_method/,
          rows: [
            { payment_method: 'credit', amount: '10', cnt: '1' },
            { payment_method: 'boleto', amount: '999', cnt: '9' },
          ],
        },
      ]);
      const out = await svc.report(STORE, { ...BASE_QUERY });
      expect(out.total).toEqual({ amount: 10, count: 1 });
    });

    it('voucher soma refeição e alimentação num grupo só e entra no total', async () => {
      const { svc } = fakeDb([
        {
          match: /group by payment_method/,
          rows: [
            { payment_method: 'credit', amount: '10', cnt: '1' },
            { payment_method: 'meal_voucher', amount: '30', cnt: '2' },
            { payment_method: 'food_voucher', amount: '10', cnt: '1' },
          ],
        },
      ]);
      const out = await svc.report(STORE, { ...BASE_QUERY });
      expect(out.byMethod.voucher).toEqual({ amount: 40, count: 3 });
      expect(out.total).toEqual({ amount: 50, count: 4 });
      expect(out.kpis.shareVoucher).toBe(80);
    });

    it('filtro de aprovadas inclui os dois valores de voucher do banco', async () => {
      const { svc, calls } = fakeDb();
      await svc.report(STORE, { ...BASE_QUERY });
      const c = sqlFor(calls, /group by payment_method/);
      expect(c!.sql).toContain("'meal_voucher','food_voucher'");
    });
  });

  describe('recortes', () => {
    it('byHour pede as 24 horas via generate_series', async () => {
      const { svc, calls } = fakeDb();
      await svc.report(STORE, { ...BASE_QUERY });
      const c = sqlFor(calls, /generate_series\(0, 23\)/);
      expect(c).toBeDefined();
      expect(c!.sql).toContain('left join');
    });

    it('byTotem rateia entre totens DISTINTOS (senão o totem receberia o dobro)', async () => {
      const { svc, calls } = fakeDb();
      await svc.report(STORE, { ...BASE_QUERY });
      const c = sqlFor(calls, /tx_totem/);
      expect(c!.sql).toContain('select distinct');
      expect(c!.sql).toContain('nullif(q.n, 0)');
      expect(c!.sql).toContain("'Sem totem'");
    });

    it('byProductTop10 rateia por subtotal e exclui item cancelado', async () => {
      const { svc, calls } = fakeDb();
      await svc.report(STORE, { ...BASE_QUERY });
      const c = sqlFor(calls, /subtotal_tx/);
      expect(c!.sql).toContain("<> 'cancelled'");
      expect(c!.sql).toContain('nullif(b.subtotal_tx, 0)');
    });

    it('byMonthYoY cobre todos os meses e desloca o ano anterior em +1 ano', async () => {
      const { svc, calls } = fakeDb();
      await svc.report(STORE, { ...BASE_QUERY });
      const c = sqlFor(calls, /interval '1 month'/);
      expect(c!.sql).toContain("+ interval '1 year'");
      expect(c!.sql).toContain("- interval '1 year'");
    });

    it('nfce ignora manual_review e unusable', async () => {
      const { svc, calls } = fakeDb();
      await svc.report(STORE, { ...BASE_QUERY });
      const c = sqlFor(calls, /vw_nfce_notes/);
      expect(c!.sql).toContain("not in ('manual_review', 'unusable')");
    });
  });

  describe('lista recente paginada', () => {
    it('pede limit+1 para saber se há próxima página sem count(*)', async () => {
      const { svc, calls } = fakeDb();
      await svc.report(STORE, { ...BASE_QUERY, recentLimit: 50, recentOffset: 100 });
      const c = sqlFor(calls, /order by created_at desc\s+limit \$4/);
      expect(c!.params[3]).toBe(51);
      expect(c!.params[4]).toBe(100);
    });

    it('hasMore true e a linha extra NÃO vaza para o cliente', async () => {
      const rows = Array.from({ length: 4 }, (_, i) => ({
        id: `t${i}`,
        created_at: new Date('2026-07-30T12:00:00.000Z'),
        payment_method: 'credit',
        amount: '10',
      }));
      const { svc } = fakeDb([{ match: /limit \$4::int offset \$5::int/, rows }]);
      const out = await svc.report(STORE, { ...BASE_QUERY, recentLimit: 3 });
      expect(out.recentApproved).toHaveLength(3);
      expect(out.recentApprovedMeta.hasMore).toBe(true);
      expect(out.recentApproved[0].created_at).toBe('2026-07-30T12:00:00.000Z');
    });

    it('exatamente `limit` linhas → hasMore false', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({
        id: `t${i}`,
        created_at: null,
        payment_method: 'pix',
        amount: '1',
      }));
      const { svc } = fakeDb([{ match: /limit \$4::int offset \$5::int/, rows }]);
      const out = await svc.report(STORE, { ...BASE_QUERY, recentLimit: 3 });
      expect(out.recentApprovedMeta.hasMore).toBe(false);
    });
  });

  it('a resposta inteira respeita o contrato', async () => {
    const { svc } = fakeDb([
      {
        match: /group by payment_method/,
        rows: [{ payment_method: 'debit', amount: '55.5', cnt: '2' }],
      },
      {
        match: /generate_series\(0, 23\)/,
        rows: [{ hour: '13', label: '13h', credit: '0', debit: '55.5', pix: '0' }],
      },
      {
        match: /to_char\(created_at::date, 'DD\/MM'\)/,
        rows: [{ day: '2026-07-30', label: '30/07', credit: '0', debit: '55.5', pix: '0' }],
      },
    ]);
    const out = await svc.report(STORE, { ...BASE_QUERY });
    expect(() => revenueReportSchema.parse(out)).not.toThrow();
    expect(out.byDay[0].total).toBe(55.5);
    expect(out.byHour[0].total).toBe(55.5);
  });
});
