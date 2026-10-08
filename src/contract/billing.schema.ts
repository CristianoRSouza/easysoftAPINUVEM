import { z } from 'zod';

/**
 * Billing — créditos de IA, log de uso, licença e planos.
 *
 * Base: `apps/api/src/modules/billing-data` do EasyML. Lá o desenho já está provado:
 * o browser NÃO fala com `billing.*`; ele pede à API, que filtra por empresa/loja com o
 * valor que o `TenantGuard` validou. Aqui é o mesmo desenho, adaptado a esta API (SQL
 * literal via `pg`, em vez do query builder do EasyML).
 *
 * A forma dos objetos é a que a tela JÁ consome hoje (`useAICredits`, `useLicenseStatus`,
 * `usePlanHistoryWindow` no Manager-Web). Copiar em vez de "melhorar" é proposital: a
 * migração tem que ser invisível.
 *
 * ⚠️ NUNCA exponha aqui coluna de credencial de pagamento (`stripe_price_id`,
 * `stripe_product_id`, `stripe_customer_id`): quem cobra é o EasyBilling, e este produto
 * só LÊ. Os endpoints selecionam colunas por nome, nunca `select *` em `module_plans`.
 */

// ── Créditos e uso ────────────────────────────────────────────────────────────

/**
 * Uma linha de `billing.usage_log_enriched` (view sobre `usage_log`).
 *
 * Sem `company_id`/`store_id`: a resposta é sempre da empresa+loja que o cliente pediu
 * nos headers, então devolvê-los seria eco. O guard de tenant deste repo trata campo de
 * tenant em contrato como entrada — e ele está certo em desconfiar: a única razão para
 * um deles aparecer num schema é alguém pretender aceitá-lo do cliente.
 */
export const usageLogEntrySchema = z.object({
  id: z.string(),
  user_id: z.string(),
  service_type: z.string(),
  module: z.string(),
  function_name: z.string(),
  action: z.string().nullable(),
  model_used: z.string().nullable(),
  tokens_input: z.number(),
  tokens_output: z.number(),
  tokens_total: z.number(),
  credits_consumed: z.number(),
  was_free: z.boolean(),
  input_summary: z.string().nullable(),
  output_summary: z.string().nullable(),
  status: z.string(),
  error_message: z.string().nullable(),
  duration_ms: z.number().nullable(),
  created_at: z.string(),
  app_source: z.string().nullable(),
  platform_display_name: z.string().nullable(),
});
export type UsageLogEntry = z.infer<typeof usageLogEntrySchema>;

/**
 * Uma linha de `billing.credit_transactions`. O saldo é a SOMA de `amount`.
 * Sem campos de tenant, pelo mesmo motivo de `usageLogEntrySchema`.
 */
export const creditTransactionSchema = z.object({
  id: z.string(),
  credit_type: z.string(),
  type: z.string(),
  amount: z.number(),
  description: z.string().nullable(),
  reference_id: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});
export type CreditTransaction = z.infer<typeof creditTransactionSchema>;

/**
 * Teto da listagem. O default 200 é o mesmo que a tela pedia ao PostgREST; o máximo
 * existe para um `limit` grande não virar varredura da tabela inteira.
 */
export const billingListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).default(200),
});
export type BillingListQuery = z.infer<typeof billingListQuerySchema>;

// ── Licença ───────────────────────────────────────────────────────────────────

/**
 * Estado da licença, já CLASSIFICADO pelo servidor.
 *
 * A classificação (expirado / expira em breve / ativo) vivia dentro do hook
 * `useLicenseStatus`. Mudou de casa de propósito: regra de negócio é da API — assim a
 * mesma resposta vale para qualquer cliente e não há duas versões da regra para manter.
 */
export const licenseStateSchema = z.enum(['active', 'expiring_soon', 'expired', 'unknown']);
export type LicenseState = z.infer<typeof licenseStateSchema>;

export const licenseStatusSchema = z.object({
  state: licenseStateSchema,
  planSlug: z.string().nullable(),
  planName: z.string().nullable(),
  expiresAt: z.string().nullable(),
  isActive: z.boolean().nullable(),
  /** Dias até expirar (negativo = já expirou). `null` quando não há data. */
  daysUntilExpiry: z.number().nullable(),
});
export type LicenseStatus = z.infer<typeof licenseStatusSchema>;

/**
 * Janela de histórico permitida pelo plano ativo (`module_plans.history_window_days`).
 * `historyWindowDays: null` = sem limite — é também o fallback quando não há plano, para
 * não bloquear usuário legítimo por falta de cadastro.
 */
export const planHistoryWindowSchema = z.object({
  planSlug: z.string().nullable(),
  planName: z.string().nullable(),
  historyWindowDays: z.number().nullable(),
});
export type PlanHistoryWindow = z.infer<typeof planHistoryWindowSchema>;

// ── Catálogo de planos ────────────────────────────────────────────────────────

/**
 * Um plano do catálogo (`billing.module_plans`), sem NADA de Stripe.
 * As colunas são selecionadas por nome no service — acrescentar campo aqui exige
 * acrescentar na consulta, e é aí que se decide se ele pode ou não sair da API.
 */
export const modulePlanSchema = z.object({
  slug: z.string(),
  module: z.string(),
  name: z.string(),
  tier: z.string().nullable(),
  price_brl: z.number().nullable(),
  history_window_days: z.number().nullable(),
  is_mock: z.boolean().nullable(),
  coming_soon: z.boolean().nullable(),
  max_users: z.number().nullable(),
  sort_order: z.number().nullable(),
  features: z.array(z.string()),
});
export type ModulePlan = z.infer<typeof modulePlanSchema>;

/**
 * Módulo de billing deste produto. É o valor gravado em `billing.module_plans.module`
 * pelas migrações do Manager (`easycommandpay-totem` — nome interno antigo, mantido
 * de propósito: renomear quebraria as licenças já vendidas).
 *
 * Usado SÓ no catálogo (`GET /billing/plans`). As consultas de licença NÃO filtram por
 * módulo — ver a nota em `billing.service.ts`.
 */
export const BILLING_MODULE = 'easycommandpay-totem';
