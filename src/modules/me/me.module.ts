import { Module } from '@nestjs/common';
import { MeService } from './application/me.service';
import { MeController } from './http/me.controller';
import { AuthUserClient } from './infrastructure/auth-user.client';
import { MeRepository } from './infrastructure/me.repository';

@Module({
  controllers: [MeController],
  providers: [MeService, MeRepository, AuthUserClient],
})
export class MeModule {}
