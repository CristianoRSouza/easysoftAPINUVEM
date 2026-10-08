import { Module } from '@nestjs/common';
import { BillingService } from './application/billing.service';
import { BillingController } from './http/billing.controller';
import { BillingRepository } from './infrastructure/billing.repository';

/**
 * Leitura de `billing.*` (créditos de IA, uso, licença, planos).
 *
 * `BillingService` é exportado porque o módulo de IA depende dele para a cota diária: a
 * contagem de interações cobráveis do dia e o saldo são a MESMA contabilidade que alimenta
 * o painel de créditos, e duas implementações da mesma conta acabariam divergindo.
 *
 * `DbModule` é global — não precisa ser importado aqui.
 */
@Module({
  controllers: [BillingController],
  providers: [BillingService, BillingRepository],
  exports: [BillingService],
})
export class BillingModule {}
