import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import { ServiceRole } from './service-role';
import { SupabaseAdmin } from './supabase-admin';
import { SessionService } from './session.service';

/** Infra de dados global: pool pg, chokepoint de service_role, Auth admin e sessões. */
@Global()
@Module({
  providers: [DbService, ServiceRole, SupabaseAdmin, SessionService],
  exports: [DbService, ServiceRole, SupabaseAdmin, SessionService],
})
export class DbModule {}
