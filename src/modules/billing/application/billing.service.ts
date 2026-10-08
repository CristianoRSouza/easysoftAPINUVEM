import { Injectable } from '@nestjs/common';
import {
  BILLING_MODULE,
  type CreditTransaction,
  type LicenseStatus,
  type ModulePlan,
  type PlanHistoryWindow,
  type UsageLogEntry,
} from '../../../contract/billing.schema';
import {
  mapCreditTransaction,
  mapModulePlan,
  mapPlanHistoryWindow,
  mapUsageLogEntry,
} from '../domain/billing.mapper';
import { classifyLicense } from '../domain/license-status.rule';
import { BillingRepository } from '../infrastructure/billing.repository';

/**
 * Billing na nuvem: créditos de IA, log de uso, licença e catálogo de planos.
 *
 * O que muda em relação a antes: o browser lia `billing.*` direto pelo PostgREST, com um
 * segundo cliente Supabase só para o schema `billing` (`billing-supabase.ts`) e a RLS como
 * única barreira. Agora quem lê é a API, e o recorte por empresa/loja é um `where`
 * explícito com o valor que o `TenantGuard` já validou contra o dono da sessão.
 *
 * ── Uma divergência deliberada em relação ao EasyML ────────────────────────────────
 * O EasyML filtra `company_licenses`/`license_history` por `module = 'easyml'`. Aqui NÃO
 * se filtra por módulo, porque é exatamente isso que o Manager-Web faz hoje
 * (`useLicenseStatus`/`usePlanHistoryWindow` pegam a licença mais recente da empresa, seja
 * de que módulo for). Acrescentar o filtro agora mudaria o plano exibido para quem tem
 * licença de mais de um produto Easy* — é uma decisão de produto, não um detalhe de
 * migração, e por isso fica de fora daqui. Quando for tomada, o lugar é
 * `BillingRepository.findLatestLicense`/`findActiveLicensePlan` e a constante
 * `BILLING_MODULE` já existe.
 *
 * Cada método é um caso de uso de leitura: o SQL está em `BillingRepository`, a forma do
 * fio em `billing.mapper.ts` e a classificação da licença em `license-status.rule.ts`.
 */
@Injectable()
export class BillingService {
  constructor(private readonly repository: BillingRepository) {}

  // ── Créditos de IA ──────────────────────────────────────────────────────────

  /** Transações de crédito da LOJA (empresa + loja: crédito de IA é por loja). */
  async listCreditTransactions(
    companyId: string,
    storeId: string,
    limit: number,
  ): Promise<CreditTransaction[]> {
    const rows = await this.repository.findCreditTransactions(companyId, storeId, limit);
    return rows.map(mapCreditTransaction);
  }

  /** Log de uso da LOJA, com o `platform_display_name` que só a view tem. */
  async listUsageLog(companyId: string, storeId: string, limit: number): Promise<UsageLogEntry[]> {
    const rows = await this.repository.findUsageLog(companyId, storeId, limit);
    return rows.map(mapUsageLogEntry);
  }

  // ── Licença e plano ─────────────────────────────────────────────────────────

  /** Estado da licença da empresa, já classificado (regra em `classifyLicense`). */
  async licenseStatus(companyId: string): Promise<LicenseStatus> {
    const row = await this.repository.findLatestLicense(companyId);
    return classifyLicense(row, Date.now());
  }

  /**
   * Janela de histórico que o plano ATIVO permite consultar nos relatórios.
   *
   * Diferença sutil e proposital em relação a `licenseStatus()`: aqui só conta licença com
   * `is_active = true`. É o que a tela fazia, e faz sentido — restringir o histórico de
   * alguém com base numa licença já desativada seria punir por um registro morto.
   *
   * Sem plano, ou plano sem janela cadastrada → `historyWindowDays: null` (sem restrição).
   */
  async planHistoryWindow(companyId: string): Promise<PlanHistoryWindow> {
    return mapPlanHistoryWindow(await this.repository.findActiveLicensePlan(companyId));
  }

  /** Catálogo de planos ativos deste produto. */
  async listPlans(): Promise<ModulePlan[]> {
    return (await this.repository.findActivePlans(BILLING_MODULE)).map(mapModulePlan);
  }

  // ── Cota diária de IA: não mora mais aqui ───────────────────────────────────
  //
  // Existia um `aiQuotaSnapshot()` neste serviço, que contava as interações do dia e somava o
  // saldo de créditos para o chat decidir se cobrava. Saiu junto com a IA própria (ADR-0003):
  // quem mede e cobra IA é o EasyBilling, num lugar só.
  //
  // As rotas `GET billing/credits` e `GET billing/usage` acima continuam — elas LEEM o
  // extrato para a tela mostrar, o que é diferente de decidir cobrança. A conta que decide
  // não pode existir em dois lugares: enquanto existiu, uma correção feita lá (não cobrar
  // por pergunta de navegação) não chegava aqui, e o mesmo cliente era cobrado de formas
  // diferentes conforme por qual produto entrasse.
}
