import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import type { Row } from '../../../db/queryable';

/**
 * Leituras de `billing.*`. Só `select`: este produto não cobra (ver `BillingController`),
 * e o guard `billing-boundary` reprova qualquer escrita que apareça aqui.
 *
 * O recorte por empresa/loja é um `where` explícito com o valor que o `TenantGuard` já
 * validou contra o dono da sessão — o role desta API não depende da RLS.
 */
@Injectable()
export class BillingRepository {
  constructor(private readonly db: DbService) {}

  /**
   * Transações de crédito da LOJA. O crédito de IA é por loja desde a migração de
   * 2026-05-14 (`credit_transactions.store_id`), então o par empresa+loja é o recorte —
   * `company_id` sozinho devolveria o crédito das outras lojas da mesma empresa.
   */
  async findCreditTransactions(companyId: string, storeId: string, limit: number): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select id, credit_type, type, amount, description,
              reference_id, created_by, created_at
         from billing.credit_transactions
        where company_id = $1::uuid and store_id = $2::uuid
        order by created_at desc
        limit $3`,
      [companyId, storeId, limit],
    );
    return rows;
  }

  /**
   * Log de uso da LOJA. Lê a view `usage_log_enriched` (e não a tabela crua) porque ela
   * acrescenta `platform_display_name` — o nome legível do sistema de origem, que o painel
   * de créditos já declarava no tipo e nunca recebia, por a tela consultar `usage_log`.
   */
  async findUsageLog(companyId: string, storeId: string, limit: number): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select id, user_id, service_type, module, function_name,
              action, model_used, tokens_input, tokens_output, tokens_total,
              credits_consumed, was_free, input_summary, output_summary, status,
              error_message, duration_ms, created_at, app_source, platform_display_name
         from billing.usage_log_enriched
        where company_id = $1::uuid and store_id = $2::uuid
        order by created_at desc
        limit $3`,
      [companyId, storeId, limit],
    );
    return rows;
  }

  /**
   * Licença mais recente da empresa, ativa ou não.
   *
   * Uma consulta só: o `left join` com `module_plans` substitui a segunda ida ao banco que
   * a tela fazia para descobrir o nome comercial do plano.
   */
  async findLatestLicense(companyId: string): Promise<Row | undefined> {
    const { rows } = await this.db.query<Row>(
      `select cl.plan_name, cl.expires_at, cl.is_active, mp.name as plan_display_name
         from billing.company_licenses cl
         left join billing.module_plans mp on mp.slug = cl.plan_name
        where cl.company_id = $1::uuid
        order by cl.created_at desc
        limit 1`,
      [companyId],
    );
    return rows[0];
  }

  /** Licença ATIVA mais recente, com a janela de histórico do plano dela. */
  async findActiveLicensePlan(companyId: string): Promise<Row | undefined> {
    const { rows } = await this.db.query<Row>(
      `select cl.plan_name, mp.name as plan_display_name, mp.history_window_days
         from billing.company_licenses cl
         left join billing.module_plans mp on mp.slug = cl.plan_name
        where cl.company_id = $1::uuid and cl.is_active = true
        order by cl.created_at desc
        limit 1`,
      [companyId],
    );
    return rows[0];
  }

  /**
   * Catálogo de planos ativos de um módulo.
   *
   * Colunas escolhidas UMA A UMA: `module_plans` guarda `stripe_price_id`/
   * `stripe_product_id`, e um `select *` os mandaria para o navegador. Este produto não
   * fala com o Stripe — quem cobra é o EasyBilling.
   */
  async findActivePlans(module: string): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select slug, module, name, tier, price_brl, history_window_days,
              is_mock, coming_soon, max_users, sort_order, features
         from billing.module_plans
        where module = $1 and is_active = true
        order by sort_order, name`,
      [module],
    );
    return rows;
  }
}
