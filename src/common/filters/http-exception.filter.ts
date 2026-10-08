import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { correlacaoAtual } from '../logging/request-context';

/**
 * Envelope de erro estável (EasyML §3): toda resposta de erro sai como
 * `{ error, message, statusCode, details? }`. O cliente trata isso, nunca status cru.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('http');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'internal_error';
    let message = 'Erro interno.';
    let details: unknown;

    let internalDetail = message;
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        error = (b.error as string) ?? httpError(statusCode);
        message = (b.message as string) ?? message;
        details = b.details;
      }
      internalDetail = message;
    } else if (ehCorpoGrandeDemais(exception)) {
      /**
       * `entity.too.large` do body-parser é um Error com `status`, não uma HttpException —
       * então caía no ramo genérico e virava **500 "Erro interno"**. Para quem chama isso é
       * indistinguível de servidor quebrado: o worker de sync não tinha como saber que devia
       * mandar lotes menores, e reenviava o mesmo corpo para sempre.
       *
       * 413 com o teto no texto é o que transforma "o servidor caiu" em "manda menos".
       */
      statusCode = HttpStatus.PAYLOAD_TOO_LARGE;
      error = 'payload_too_large';
      message =
        'Corpo da requisição acima do limite. Envie em lotes menores ' +
        '(o teto do servidor é HTTP_BODY_LIMIT).';
      internalDetail = (exception as Error).message;
    } else if (exception instanceof Error) {
      internalDetail = exception.message; // fica SÓ no log
    }

    const corr = correlacaoAtual();

    if (statusCode >= 500) {
      // `corr` no log E no corpo da resposta: é o que permite ao suporte pedir "qual o
      // código que apareceu na tela?" e achar a requisição exata, em vez de caçar pelo
      // horário aproximado.
      this.log.error(
        `${internalDetail}${corr ? ` | corr=${corr}` : ''}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      // Erro não tratado: NÃO vazar detalhe interno (schema/pg/e-mail) ao cliente.
      if (!(exception instanceof HttpException)) {
        error = 'internal_error';
        message = 'Erro interno.';
        details = undefined;
      }
    }

    res.status(statusCode).json({
      error,
      message,
      statusCode,
      // Só o identificador da requisição — não é detalhe interno, e sem ele o cliente
      // não tem como referenciar o problema.
      ...(corr ? { requestId: corr } : {}),
      ...(details ? { details } : {}),
    });
  }
}

function httpError(status: number): string {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return 'error';
}

/** Erro do body-parser quando o corpo passa do teto (`limit`). */
function ehCorpoGrandeDemais(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { type?: unknown; status?: unknown; statusCode?: unknown };
  return (
    err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413
  );
}
