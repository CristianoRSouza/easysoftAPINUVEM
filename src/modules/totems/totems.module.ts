import { Module } from '@nestjs/common';
import { TotemsService } from './application/totems.service';
import { TotemsController } from './http/totems.controller';

@Module({
  controllers: [TotemsController],
  providers: [TotemsService],
})
export class TotemsModule {}
