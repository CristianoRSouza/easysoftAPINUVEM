import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { ENV, type Env } from './config/env';
import { SessionThrottlerGuard } from './common/guards/session-throttler.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { TenantModule } from './common/tenant/tenant.module';
import { DbModule } from './db/db.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { AuthModule } from './modules/auth/auth.module';
import { MeModule } from './modules/me/me.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OperationsModule } from './modules/operations/operations.module';
import { NfceModule } from './modules/nfce/nfce.module';
import { CbsModule } from './modules/cbs/cbs.module';
import { DevicesModule } from './modules/devices/devices.module';
import { SyncPanelModule } from './modules/sync-panel/sync-panel.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { TotemsModule } from './modules/totems/totems.module';
import { StoresModule } from './modules/stores/stores.module';
import { SyncModule } from './modules/sync/sync.module';
import { StorageModule } from './modules/storage/storage.module';
import { BillingModule } from './modules/billing/billing.module';
import { AiModule } from './modules/ai/ai.module';
import { HealthController } from './modules/health/http/health.controller';
import { AuthGuard } from './common/guards/auth.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

/**
 * Módulo raiz. AuthGuard e filtro de erro são GLOBAIS: toda rota (menos @Public)
 * exige sessão de usuário ou X-Service-Key (§2), e todo erro sai no envelope padrão.
 */
@Module({
  imports: [
    ConfigModule,
    // Rate-limit global contado por SESSÃO (ver SessionThrottlerGuard); anônimo cai no IP.
    // login/recovery apertam para 10/min com @Throttle — e, por serem anônimos, contam
    // por IP, que é o que se quer contra força bruta.
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => [
        { ttl: env.RATE_LIMIT_TTL_SECONDS * 1000, limit: env.RATE_LIMIT_LIMIT },
      ],
    }),
    DbModule,
    TenantModule,
    TenantsModule,
    AuthModule,
    MeModule,
    CatalogModule,
    OperationsModule,
    NfceModule,
    CbsModule,
    DevicesModule,
    SyncPanelModule,
    TelemetryModule,
    TotemsModule,
    StoresModule,
    SyncModule,
    StorageModule,
    BillingModule,
    AiModule,
  ],
  controllers: [HealthController],
  providers: [
    // ORDEM IMPORTA — os três rodam nesta sequência:
    //   1. rate-limit  (antes de autenticar: request abusiva não deve custar consulta)
    //   2. autenticação (popula req.user)
    //   3. tenant       (DEPENDE de req.user; inverter faz o TenantGuard cair no 503 de bug)
    { provide: APP_GUARD, useClass: SessionThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
