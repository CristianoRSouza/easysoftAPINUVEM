import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelemetryService } from '../src/modules/telemetry/application/telemetry.service';
import { ErrorReportClient } from '../src/modules/telemetry/infrastructure/error-report.client';
import type { Env } from '../src/config/env';

const UPSTREAM = 'https://ohjyqafgcxvrvbtiuvpq.supabase.co/functions/v1/error-report';

const svc = (secret: string, dedicada = '') => {
  const env = {
    ERROR_REPORT_SECRET: secret,
    ERROR_REPORT_SECRET_EASYFOOD: dedicada,
    ERROR_REPORT_UPSTREAM_URL: UPSTREAM,
  } as Env;
  return new TelemetryService(new ErrorReportClient(env), env);
};

afterEach(() => vi.unstubAllGlobals());

/** Registra as chamadas de rede e responde o que for pedido. */
function fakeFetch(res: { status: number; body: string } = { status: 200, body: '{"ok":true}' }) {
  const calls: Array<{ url: string; init: any }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return { status: res.status, text: async () => res.body } as any;
    }),
  );
  return calls;
}

describe('TelemetryService — proxy do relatório de erro ao EasyGuardian', () => {
  it('sem ERROR_REPORT_SECRET: falha fechado e NÃO gasta requisição no upstream', async () => {
    const calls = fakeFetch();
    // O upstream responde 401 a header vazio; mandar assim só perde o relatório em silêncio,
    // porque o browser é fire-and-forget. Melhor falhar visível aqui.
    await expect(svc('').forwardErrorReport('{"probe":true}')).rejects.toMatchObject({
      response: { error: 'telemetry_not_configured' },
    });
    expect(calls).toHaveLength(0);
  });

  it('com o segredo: injeta o x-report-secret server-side e repassa o corpo como veio', async () => {
    const calls = fakeFetch({ status: 202, body: '{"id":"abc"}' });
    const out = await svc('segredo-de-teste').forwardErrorReport('{"app":"manager-web"}');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(UPSTREAM);
    expect(calls[0].init.headers['x-report-secret']).toBe('segredo-de-teste');
    expect(calls[0].init.body).toBe('{"app":"manager-web"}');
    // Status e corpo são do upstream — a API não reinterpreta o contrato do EasyGuardian.
    expect(out).toEqual({ status: 202, body: '{"id":"abc"}' });
  });

  it('a dedicada do EasyFood tem precedência sobre a compartilhada', async () => {
    const calls = fakeFetch();
    await svc('compartilhada', 'so-do-easyfood').forwardErrorReport('{}');
    expect(calls[0].init.headers['x-report-secret']).toBe('so-do-easyfood');
  });

  it('só a compartilhada configurada: usa ela como ponte', async () => {
    const calls = fakeFetch();
    await svc('compartilhada').forwardErrorReport('{}');
    expect(calls[0].init.headers['x-report-secret']).toBe('compartilhada');
  });

  it('401 do upstream é REPASSADO, não convertido em sucesso', async () => {
    // O browser reporta fire-and-forget: se a API mascarasse o 401 como 200, a perda de
    // telemetria voltaria a ser invisível — que é o buraco que este módulo acabou de fechar.
    fakeFetch({ status: 401, body: '{"error":"Unauthorized"}' });
    const out = await svc('valor-que-o-guardian-nao-conhece').forwardErrorReport('{}');
    expect(out).toEqual({ status: 401, body: '{"error":"Unauthorized"}' });
  });
});
