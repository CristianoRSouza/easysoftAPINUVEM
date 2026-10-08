import { describe, expect, it } from 'vitest';
import {
  mapCreditTransaction,
  mapModulePlan,
  mapPlanHistoryWindow,
  mapUsageLogEntry,
} from '../src/modules/billing/domain/billing.mapper';
import {
  EXPIRING_SOON_DAYS,
  classifyLicense,
} from '../src/modules/billing/domain/license-status.rule';

const DIA = 86_400_000;
const AGORA = Date.parse('2026-08-10T12:00:00.000Z');
const em = (dias: number) => new Date(AGORA + dias * DIA);

describe('classifyLicense — a regra da licença, sem banco e com relógio fixo', () => {
  it('sem linha: `unknown`, com todos os campos nulos', () => {
    expect(classifyLicense(undefined, AGORA)).toEqual({
      state: 'unknown',
      planSlug: null,
      planName: null,
      expiresAt: null,
      isActive: null,
      daysUntilExpiry: null,
    });
  });

  it('linha sem plano continua `unknown`, mesmo com data vencida', () => {
    // A ordem das condições importa: "sem plano" é silencioso e vem antes de "expirou".
    const st = classifyLicense({ plan_name: null, expires_at: em(-10), is_active: true }, AGORA);
    expect(st.state).toBe('unknown');
    expect(st.daysUntilExpiry).toBe(-10);
  });

  it('vencida há pouco é `expired` e os dias saem negativos (arredondados para cima)', () => {
    const st = classifyLicense({ plan_name: 'ecp-pro', expires_at: em(-2.5), is_active: true }, AGORA);
    expect(st.state).toBe('expired');
    expect(st.daysUntilExpiry).toBe(-2);
  });

  it('`is_active = false` é `expired` mesmo com vencimento distante', () => {
    const st = classifyLicense({ plan_name: 'ecp-pro', expires_at: em(90), is_active: false }, AGORA);
    expect(st.state).toBe('expired');
    expect(st.isActive).toBe(false);
  });

  it('a fronteira de "expira em breve" é inclusiva no último dia', () => {
    const noLimite = classifyLicense(
      { plan_name: 'ecp-pro', expires_at: em(EXPIRING_SOON_DAYS), is_active: true },
      AGORA,
    );
    const depois = classifyLicense(
      { plan_name: 'ecp-pro', expires_at: new Date(AGORA + EXPIRING_SOON_DAYS * DIA + 1), is_active: true },
      AGORA,
    );
    expect(noLimite.state).toBe('expiring_soon');
    expect(depois.state).toBe('active');
    expect(depois.daysUntilExpiry).toBe(EXPIRING_SOON_DAYS + 1);
  });

  it('`expires_at` sai em ISO, venha como Date ou como string', () => {
    const comoDate = classifyLicense({ plan_name: 'p', expires_at: em(30) }, AGORA);
    const comoTexto = classifyLicense({ plan_name: 'p', expires_at: em(30).toISOString() }, AGORA);
    expect(comoDate.expiresAt).toBe(em(30).toISOString());
    expect(comoTexto.expiresAt).toBe(em(30).toISOString());
    expect(comoDate.isActive).toBeNull();
  });

  it('data ilegível não vira vencimento: `daysUntilExpiry` nulo e plano `active`', () => {
    const st = classifyLicense({ plan_name: 'p', expires_at: 'não é data', is_active: true }, AGORA);
    expect(st.daysUntilExpiry).toBeNull();
    expect(st.state).toBe('active');
  });

  it('o nome comercial vem do JOIN; sem ele fica nulo', () => {
    expect(classifyLicense({ plan_name: 'p', plan_display_name: 'Pro' }, AGORA).planName).toBe('Pro');
    expect(classifyLicense({ plan_name: 'p' }, AGORA).planName).toBeNull();
  });
});

describe('mapeadores de billing — o que cada campo vira quando falta', () => {
  it('transação: ausência vira string vazia / null / zero conforme o contrato', () => {
    expect(mapCreditTransaction({ id: 7 })).toEqual({
      id: '7',
      credit_type: '',
      type: '',
      amount: 0,
      description: null,
      reference_id: null,
      created_by: null,
      created_at: '',
    });
  });

  it('transação: `numeric` ilegível vira 0, e Date vira ISO', () => {
    const tx = mapCreditTransaction({ id: 'a', amount: 'abc', created_at: new Date(0) });
    expect(tx.amount).toBe(0);
    expect(tx.created_at).toBe('1970-01-01T00:00:00.000Z');
  });

  it('uso: `duration_ms` ausente é null (não zero); tokens ausentes são zero', () => {
    const uso = mapUsageLogEntry({ id: 'u1', was_free: null });
    expect(uso.duration_ms).toBeNull();
    expect(uso.tokens_total).toBe(0);
    expect(uso.was_free).toBe(false);
    expect(uso.platform_display_name).toBeNull();
  });

  it('janela do plano: sem linha ou sem slug é "sem restrição"', () => {
    const livre = { planSlug: null, planName: null, historyWindowDays: null };
    expect(mapPlanHistoryWindow(undefined)).toEqual(livre);
    expect(mapPlanHistoryWindow({ plan_name: null, history_window_days: '30' })).toEqual(livre);
    expect(mapPlanHistoryWindow({ plan_name: '', history_window_days: '30' })).toEqual(livre);
  });

  it('janela do plano: dias saem como número e o nome pode faltar', () => {
    expect(mapPlanHistoryWindow({ plan_name: 'ecp-pro', history_window_days: '365' })).toEqual({
      planSlug: 'ecp-pro',
      planName: null,
      historyWindowDays: 365,
    });
  });

  it('plano: números opcionais distinguem "não veio" de zero', () => {
    const p = mapModulePlan({ slug: 's', module: 'm', name: 'N', price_brl: '0', max_users: null, is_mock: false });
    expect(p.price_brl).toBe(0);
    expect(p.max_users).toBeNull();
    expect(p.is_mock).toBe(false);
    expect(p.coming_soon).toBeNull();
    expect(p.tier).toBeNull();
  });

  it('plano: `features` que não é array vira lista vazia; itens viram string', () => {
    expect(mapModulePlan({ features: { a: 1 } }).features).toEqual([]);
    expect(mapModulePlan({ features: 'x' }).features).toEqual([]);
    expect(mapModulePlan({ features: [1, 'b'] }).features).toEqual(['1', 'b']);
  });
});
