import { Body, Controller, HttpException, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SkipTenant } from '../../../common/decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiSessionAuth } from '../../../common/swagger';
import { TelemetryService } from '../application/telemetry.service';
import { errorReportSchema } from '../dto/error-report.schema';
import { DocErrorReport } from './telemetry.docs';

/** Exige sessão (ramo default do AuthGuard) — bloqueia spam anônimo, como a edge function. */
@ApiTags('Telemetria')
@ApiSessionAuth()
// Relatório de erro não é dado de empresa — pode acontecer em qualquer tela, inclusive
// antes de o usuário escolher uma. Exigir X-Company-Id aqui perderia justamente o crash.
@SkipTenant()
@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly service: TelemetryService) {}

  @Post('error-report')
  @DocErrorReport()
  async errorReport(
    @Body(new ZodValidationPipe(errorReportSchema)) body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    let out: { status: number; body: string };
    try {
      out = await this.service.forwardErrorReport(JSON.stringify(body ?? {}));
    } catch (err) {
      // 502 é para falha de REDE. Erro já tipado pelo serviço (ex.: 503
      // `telemetry_not_configured`) passa direto — senão a causa vira ruído genérico.
      if (err instanceof HttpException) throw err;
      res.status(502);
      return { error: 'upstream_unreachable', message: 'Falha ao encaminhar o relatório.' };
    }
    res.status(out.status);
    try {
      return JSON.parse(out.body);
    } catch {
      return { raw: out.body };
    }
  }
}
