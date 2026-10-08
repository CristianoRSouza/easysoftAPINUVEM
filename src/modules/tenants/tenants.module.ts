import { Module } from '@nestjs/common';
import { TenantsService } from './application/tenants.service';
import { TenantsController } from './http/tenants.controller';
import { TenantAuthClient } from './infrastructure/tenant-auth.client';
import { TenantsRepository } from './infrastructure/tenants.repository';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, TenantsRepository, TenantAuthClient],
})
export class TenantsModule {}
