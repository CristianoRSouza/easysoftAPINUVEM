import { Module } from '@nestjs/common';
import { OperationsService } from './application/operations.service';
import { RevenueService } from './application/revenue.service';
import { OperationsController } from './http/operations.controller';
import { OperationsRepository } from './infrastructure/operations.repository';
import { RevenueRepository } from './infrastructure/revenue.repository';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, RevenueService, OperationsRepository, RevenueRepository],
})
export class OperationsModule {}
