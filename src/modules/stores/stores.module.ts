import { Module } from '@nestjs/common';
import { StoresService } from './application/stores.service';
import { StoresController } from './http/stores.controller';

@Module({
  controllers: [StoresController],
  providers: [StoresService],
})
export class StoresModule {}
