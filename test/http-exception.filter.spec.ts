import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

function fakeHost() {
  const res: { statusCode?: number; body?: unknown; status: (n: number) => any; json: (b: unknown) => any } = {
    status(n: number) {
      res.statusCode = n;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as any;
  return { res, host };
}

describe('HttpExceptionFilter (#7 — não vaza detalhe interno)', () => {
  it('Error cru (não-HttpException) → 500 genérico, sem a mensagem real', () => {
    const filter = new HttpExceptionFilter();
    // silencia o logger de erro esperado
    vi.spyOn((filter as any).log, 'error').mockImplementation(() => undefined);
    const { res, host } = fakeHost();

    filter.catch(new Error('relation "billing.secret" — coluna token_hash vazou'), host);

    expect(res.statusCode).toBe(500);
    const body = res.body as any;
    expect(body.error).toBe('internal_error');
    expect(body.message).toBe('Erro interno.');
    expect(JSON.stringify(body)).not.toContain('billing');
    expect(JSON.stringify(body)).not.toContain('token_hash');
    expect(body.details).toBeUndefined();
  });

  /**
   * `entity.too.large` do body-parser e' um Error com `status`, nao uma HttpException —
   * entao caia no ramo generico e virava 500 "Erro interno". Para quem chama, isso e'
   * indistinguivel de servidor quebrado: o worker de sync nao tinha como saber que devia
   * mandar lotes menores, e reenviava o mesmo corpo para sempre (a fila nunca drenava).
   */
  it('corpo grande demais → 413 acionável, não 500', () => {
    const filter = new HttpExceptionFilter();
    const erroDoBodyParser = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });
    const { res, host } = fakeHost();

    filter.catch(erroDoBodyParser, host);

    expect(res.statusCode).toBe(413);
    const body = res.body as any;
    expect(body.error).toBe('payload_too_large');
    // o texto tem que DIZER o que fazer, senao o cliente nao tem como reagir
    expect(body.message).toMatch(/lotes menores/i);
  });

  it('erro com statusCode 413 (sem `type`) tambem vira 413', () => {
    const filter = new HttpExceptionFilter();
    const { res, host } = fakeHost();
    filter.catch(Object.assign(new Error('too large'), { statusCode: 413 }), host);
    expect(res.statusCode).toBe(413);
  });

  it('HttpException preserva status e mensagem intencional (ex.: 403)', () => {
    const filter = new HttpExceptionFilter();
    const { res, host } = fakeHost();

    filter.catch(new HttpException({ error: 'forbidden', message: 'Sem permissão para esta loja.' }, HttpStatus.FORBIDDEN), host);

    expect(res.statusCode).toBe(403);
    const body = res.body as any;
    expect(body.error).toBe('forbidden');
    expect(body.message).toBe('Sem permissão para esta loja.');
  });

  it('BadRequest (400) da validação Zod passa a mensagem, não é mascarado', () => {
    const filter = new HttpExceptionFilter();
    const { res, host } = fakeHost();

    filter.catch(new BadRequestException({ error: 'invalid_input', message: 'Payload inválido.', details: [{ path: 'store_id' }] }), host);

    expect(res.statusCode).toBe(400);
    const body = res.body as any;
    expect(body.message).toBe('Payload inválido.');
    expect(body.details).toBeDefined();
  });
});
