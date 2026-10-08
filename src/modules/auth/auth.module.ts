import { Module } from '@nestjs/common';
import { AuthService } from './application/auth.service';
import { PasswordRecoveryService } from './application/password-recovery.service';
import { AuthController } from './http/auth.controller';
import { EasyMailClient } from './infrastructure/easymail.client';
import { SupabaseAuthClient } from './infrastructure/supabase-auth.client';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordRecoveryService, SupabaseAuthClient, EasyMailClient],
})
export class AuthModule {}
