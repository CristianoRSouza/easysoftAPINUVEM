import { describe, expect, it, vi } from 'vitest';
import { BillingService } from '../src/modules/billing/application/billing.service';
import { BillingRepository } from '../src/modules/billing/infrastructure/billing.repository';
import {
  creditTransactionSchema,
  licenseStatusSchema,
  modulePlanSchema,
  planHistoryWindowSchema,
  usageLogEntrySchema,
} from '../src/contract/billing.schema';
import type { DbService } from '../src/db/db.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const STORE = '33333333-3333-4333-8333-333333333333';

function fakeDb(...respostas: any[][]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows: respostas[i++] ?? [] };
    }),
  } as unknown as DbService;
  return { db, calls, svc: new BillingService(new BillingRepository(db)) };
}

const emDias = (dias: number) => new Date(Date.now() + dias * 86_400_000);

describe('BillingService — o recorte que a RLS fazia quando o browser lia billing direto', () => {
  describe('crédito e uso são da LOJA, não só da empresa', () => {
    it.each([
      ['créditos', (s: BillingService) => s.listCreditTransactions(COMPANY, STORE, 200)],
      ['uso', (s: BillingService) => s.listUsageLog(COMPANY, STORE, 200)],
    ])('%s filtra por empresa E loja', async (_nome, chamar) => {
      const { svc, calls } = fakeDb();
      await chamar(svc);
      // Sem o store_id, o painel de uma loja mostraria o saldo somado das outras —
      // crédito de IA é por loja desde a migração de 2026-05-14.
      expect(calls[0].sql).toContain('company_id = $1::uuid and store_id = $2::uuid');
      expect(calls[0].params).toEqual([COMPANY, STORE, 200]);
    });

    it('a resposta NÃO devolve company_id/store_id — seria eco do que o cliente pediu', async () => {
      const { svc } = fakeDb(
        [{ id: 'tx1', credit_type: 'ai', type: 'purchase', amount: '10.5', created_at: new Date(0) }],
        [{ id: 'u1', user_id: 'u', service_type: 'ai', module: 'ai-chat', function_name: 'ai-chat', status: 'success', created_at: new Date(0) }],
      );
      const [tx] = await svc.listCreditTransactions(COMPANY, STORE, 200);
      const [uso] = await svc.listUsageLog(COMPANY, STORE, 200);
      expect(tx).not.toHaveProperty('company_id');
      expect(tx).not.toHaveProperty('store_id');
      expect(uso).not.toHaveProperty('company_id');
      expect(uso).not.toHaveProperty('store_id');
    });

    it('`numeric` chega como string do driver e sai como NÚMERO no contrato', async () => {
      // O saldo é somado na tela: se `amount` saísse como string, "10" + "-1" viraria
      // "10-1" em vez de 9.
      const { svc } = fakeDb([{ id: 'tx1', credit_type: 'ai', type: 'consumption', amount: '-1', created_at: new Date(0) }]);
      const [tx] = await svc.listCreditTransactions(COMPANY, STORE, 200);
      expect(tx.amount).toBe(-1);
      expect(() => creditTransactionSchema.parse(tx)).not.toThrow();
    });

    it('o log de uso sai no formato do contrato, com a coluna que só a view tem', async () => {
      const { svc, calls } = fakeDb([
        {
          id: 'u1', user_id: 'u', service_type: 'ai', module: 'ai-chat', function_name: 'ai-chat',
          action: 'support', model_used: 'm', tokens_input: '1', tokens_output: '2', tokens_total: '3',
          credits_consumed: '0', was_free: true, status: 'success', duration_ms: '12',
          created_at: new Date(0), app_source: 'easyfood-manager', platform_display_name: 'EasyFood Manager',
        },
      ]);
      const [uso] = await svc.listUsageLog(COMPANY, STORE, 200);
      // A view existe justamente por causa deste campo — a tabela crua não o tem.
      expect(calls[0].sql).toContain('billing.usage_log_enriched');
      expect(uso.platform_display_name).toBe('EasyFood Manager');
      expect(() => usageLogEntrySchema.parse(uso)).not.toThrow();
    });
  });

  describe('licença — a classificação saiu do hook e virou regra do servidor', () => {
    it('sem linha nenhuma: `unknown`, e não erro', async () => {
      const { svc } = fakeDb([]);
      const st = await svc.licenseStatus(COMPANY);
      expect(st.state).toBe('unknown');
      expect(st.planSlug).toBeNull();
      expect(() => licenseStatusSchema.parse(st)).not.toThrow();
    });

    it('data no passado: `expired`', async () => {
      const { svc } = fakeDb([{ plan_name: 'ecp-pro', expires_at: emDias(-3), is_active: true, plan_display_name: 'Pro' }]);
      const st = await svc.licenseStatus(COMPANY);
      expect(st.state).toBe('expired');
      expect(st.daysUntilExpiry).toBeLessThan(0);
    });

    it('inativa sem data vencida também é `expired` — força revisão', async () => {
      const { svc } = fakeDb([{ plan_name: 'ecp-pro', expires_at: emDias(30), is_active: false, plan_display_name: 'Pro' }]);
      expect((await svc.licenseStatus(COMPANY)).state).toBe('expired');
    });

    it('vence dentro de 7 dias: `expiring_soon`', async () => {
      const { svc } = fakeDb([{ plan_name: 'ecp-pro', expires_at: emDias(3), is_active: true, plan_display_name: 'Pro' }]);
      expect((await svc.licenseStatus(COMPANY)).state).toBe('expiring_soon');
    });

    it('vence longe: `active`, e o nome comercial vem do JOIN (uma consulta, não duas)', async () => {
      const { svc, calls } = fakeDb([{ plan_name: 'ecp-pro', expires_at: emDias(90), is_active: true, plan_display_name: 'Pro' }]);
      const st = await svc.licenseStatus(COMPANY);
      expect(st.state).toBe('active');
      expect(st.planName).toBe('Pro');
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toContain('left join billing.module_plans');
    });

    it('sem data de expiração: `active` e `daysUntilExpiry` nulo (plano sem vencimento)', async () => {
      const { svc } = fakeDb([{ plan_name: 'ecp-standard', expires_at: null, is_active: true, plan_display_name: 'Standard' }]);
      const st = await svc.licenseStatus(COMPANY);
      expect(st.state).toBe('active');
      expect(st.daysUntilExpiry).toBeNull();
    });
  });

  describe('janela de histórico do plano', () => {
    it('só conta licença ATIVA — histórico não se restringe por registro morto', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.planHistoryWindow(COMPANY);
      expect(calls[0].sql).toContain('cl.is_active = true');
    });

    it('sem plano: sem restrição (fallback que não bloqueia usuário legítimo)', async () => {
      const { svc } = fakeDb([]);
      const w = await svc.planHistoryWindow(COMPANY);
      expect(w).toEqual({ planSlug: null, planName: null, historyWindowDays: null });
      expect(() => planHistoryWindowSchema.parse(w)).not.toThrow();
    });

    it('plano com janela: devolve os dias como número', async () => {
      const { svc } = fakeDb([{ plan_name: 'ecp-pro', plan_display_name: 'Pro', history_window_days: '730' }]);
      expect(await svc.planHistoryWindow(COMPANY)).toEqual({
        planSlug: 'ecp-pro',
        planName: 'Pro',
        historyWindowDays: 730,
      });
    });

    it('plano SEM janela cadastrada: ilimitado, não zero', async () => {
      // Zero seria "não pode ver nada" — o oposto do que "não cadastrado" significa.
      const { svc } = fakeDb([{ plan_name: 'ecp-demo', plan_display_name: 'Demo', history_window_days: null }]);
      expect((await svc.planHistoryWindow(COMPANY)).historyWindowDays).toBeNull();
    });
  });

  describe('catálogo de planos', () => {
    it('nunca seleciona coluna de Stripe — este produto não cobra', async () => {
      const { svc, calls } = fakeDb();
      await svc.listPlans();
      expect(calls[0].sql).not.toMatch(/stripe/i);
      expect(calls[0].sql).not.toMatch(/select\s+\*/i);
    });

    it('features torta no cadastro não derruba a tela', async () => {
      const { svc } = fakeDb([
        { slug: 'a', module: 'm', name: 'A', features: null },
        { slug: 'b', module: 'm', name: 'B', features: ['x', 'y'] },
      ]);
      const planos = await svc.listPlans();
      expect(planos[0].features).toEqual([]);
      expect(planos[1].features).toEqual(['x', 'y']);
      planos.forEach((p) => expect(() => modulePlanSchema.parse(p)).not.toThrow());
    });
  });

  describe('cobrança de IA não é decidida aqui (ADR-0003)', () => {
    it('o serviço não expõe cálculo de cota/saldo de IA', () => {
      // Regressão nomeada: existiu um `aiQuotaSnapshot()` aqui, e enquanto existiu havia DUAS
      // réguas cobrando da mesma carteira — esta e a do EasyBilling, sobre as MESMAS tabelas
      // `billing.usage_log`/`billing.credit_transactions`. Ler o extrato para a tela (as rotas
      // `credits`/`usage`) é outra coisa: quem decide se cobra é só o EasyBilling.
      const { svc } = fakeDb();
      expect((svc as unknown as Record<string, unknown>).aiQuotaSnapshot).toBeUndefined();
    });
  });
});
