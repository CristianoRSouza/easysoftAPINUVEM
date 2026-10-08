import { Module } from '@nestjs/common';
import { TelemetryService } from './application/telemetry.service';
import { TelemetryController } from './http/telemetry.controller';
import { ErrorReportClient } from './infrastructure/error-report.client';

@Module({
  controllers: [TelemetryController],
  providers: [TelemetryService, ErrorReportClient],
})
export class TelemetryModule {}
