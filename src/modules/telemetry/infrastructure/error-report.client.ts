import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../../config/env';

/** O que o EasyGuardian respondeu, sem interpretar: status e corpo cru. */
export interface UpstreamResponse {
  status: number;
  body: string;
}

/**
 * Chamada HTTP ao EasyGuardian (`ERROR_REPORT_UPSTREAM_URL`). Só transporta: quem decide
 * se há segredo para mandar é o `TelemetryService`. Falha de rede sobe como veio — o
 * controller é quem a traduz em 502.
 */
@Injectable()
export class ErrorReportClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async post(secret: string, rawJson: string): Promise<UpstreamResponse> {
    const res = await fetch(this.env.ERROR_REPORT_UPSTREAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-report-secret': secret },
      body: rawJson,
    });
    return { status: res.status, body: await res.text() };
  }
}
