import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ENV, type Env } from '../../../config/env';
import { ErrorReportClient, type UpstreamResponse } from '../infrastructure/error-report.client';

/**
 * Migra a edge function error-report-proxy: recebe o relatório de erro (do
 * usuário logado) e repassa ao EasyGuardian injetando o `x-report-secret`
 * server-side — o secret nunca vai ao browser.
 */
@Injectable()
export class TelemetryService {
  private readonly log = new Logger(TelemetryService.name);

  constructor(
    private readonly upstream: ErrorReportClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async forwardErrorReport(rawJson: string): Promise<UpstreamResponse> {
    // Fail-closed, como o `sso_not_configured`. Sem o segredo o EasyGuardian responde 401 a
    // TODO relatório, e o browser é fire-and-forget (`.catch(() => {})`) — a telemetria morre
    // em silêncio, que foi exatamente o que o cofre de prod fez (31/07/2026). Falhar aqui
    // deixa rastro no log do servidor em vez de gastar uma chamada condenada.
    const secret = this.env.ERROR_REPORT_SECRET_EASYFOOD || this.env.ERROR_REPORT_SECRET;
    if (!secret) {
      this.log.warn('ERROR_REPORT_SECRET_EASYFOOD/ERROR_REPORT_SECRET ausentes — relatório NÃO encaminhado.');
      throw new ServiceUnavailableException({
        error: 'telemetry_not_configured',
        message: 'ERROR_REPORT_SECRET_EASYFOOD/ERROR_REPORT_SECRET ausentes.',
      });
    }
    return this.upstream.post(secret, rawJson);
  }
}
