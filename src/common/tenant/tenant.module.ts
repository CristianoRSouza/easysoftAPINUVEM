import { Global, Module } from '@nestjs/common';
import { StoreAdminRepository } from './store-admin.repository';
import { TenantAccessService } from './tenant-access.service';

/**
 * Global porque o TenantGuard é global (APP_GUARD) e os services das rotas de dado
 * também precisam consultar acesso — não faz sentido cada módulo reimportar.
 */
@Global()
@Module({
  providers: [TenantAccessService, StoreAdminRepository],
  exports: [TenantAccessService, StoreAdminRepository],
})
export class TenantModule {}
