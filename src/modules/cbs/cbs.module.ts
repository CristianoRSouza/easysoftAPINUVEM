import { Module } from '@nestjs/common';
import { CbsService } from './application/cbs.service';
import { CbsController } from './http/cbs.controller';
import { CbsRepository } from './infrastructure/cbs.repository';

@Module({
  controllers: [CbsController],
  providers: [CbsService, CbsRepository],
})
export class CbsModule {}
