import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireStore, SkipTenant } from '../../../common/decorators';
import { CompanyId, StoreId } from '../../../common/http/request.decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiSessionAuth } from '../../../common/swagger';
import { billingListQuerySchema, type BillingListQuery } from '../../../contract/billing.schema';
import { BillingService } from '../application/billing.service';
import { DocCredits, DocLicense, DocPlanWindow, DocPlans, DocUsage } from './billing.docs';

/**
 * Billing — a porta de leitura de `billing.*` para o painel.
 *
 * Só GET, e só leitura: **este produto não cobra**. Quem emite licença, vende crédito e
 * fala com o Stripe é o EasyBilling; aqui se lê o resultado e se aplica a consequência
 * (cota de IA, janela de histórico, aviso de licença vencida). A mesma fronteira do
 * EasyML — lá ela é imposta por um guard de build; aqui, por não existir rota de escrita.
 *
 * Recorte por rota, e a diferença é de negócio:
 *   • crédito e uso de IA são da LOJA   → `@RequireStore()`
 *   • licença e plano são da EMPRESA    → só `X-Company-Id`
 *   • catálogo de planos é do PRODUTO   → `@SkipTenant()`
 */
@ApiTags('Billing')
@ApiSessionAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get('credits')
  @RequireStore()
  @DocCredits()
  async credits(
    @CompanyId() companyId: string,
    @StoreId() storeId: string,
    @Query(new ZodValidationPipe(billingListQuerySchema)) query: BillingListQuery,
  ) {
    return { data: await this.service.listCreditTransactions(companyId, storeId, query.limit) };
  }

  @Get('usage')
  @RequireStore()
  @DocUsage()
  async usage(
    @CompanyId() companyId: string,
    @StoreId() storeId: string,
    @Query(new ZodValidationPipe(billingListQuerySchema)) query: BillingListQuery,
  ) {
    return { data: await this.service.listUsageLog(companyId, storeId, query.limit) };
  }

  @Get('license')
  @DocLicense()
  async license(@CompanyId() companyId: string) {
    return { data: await this.service.licenseStatus(companyId) };
  }

  @Get('plan-window')
  @DocPlanWindow()
  async planWindow(@CompanyId() companyId: string) {
    return { data: await this.service.planHistoryWindow(companyId) };
  }

  @Get('plans')
  @SkipTenant()
  @DocPlans()
  async plans() {
    return { data: await this.service.listPlans() };
  }
}
