import type { NextFunction, Request, Response } from 'express';
import { EasySoftLogger } from './easysoft-logger';
import { comCorrelacao, idDaRequisicao } from './request-context';

/**
 * Uma linha por requisição.
 * @see docs/PADRAO-LOGS.md §8.2.1
 *
 * ► O QUE ISTO RESOLVE
 *
 *   Antes desta camada a API tinha UMA chamada de log em todo o código — a do erro 500.
 *   Na prática: nenhuma requisição deixava rastro, um 401 ou 403 não registrava nada, e
 *   "o totem diz que não funciona" não tinha do lado de cá nenhuma evidência para
 *   confrontar. Depurava-se só pela ponta do cliente.
 *
 * ► POR QUE MIDDLEWARE DO EXPRESS, E NÃO INTERCEPTOR DO NEST
 *
 *   O interceptor só enxerga o que chegou a casar com uma rota. Requisição barrada antes
 *   disso — 404, payload inválido, CORS — passaria batida, e é justamente o tipo de
 *   chamada que gera dúvida no suporte. O middleware vê tudo.
 *
 * ► O QUE NÃO ENTRA NO LOG
 *
 *   Corpo da requisição e da resposta ficam DE FORA, sempre. Por aqui passam senha,
 *   token de sessão, chave de serviço e dado de cliente; registrar corpo seria criar um
 *   vazamento permanente em disco por conveniência de diagnóstico. Registramos o que
 *   identifica a chamada, não o que ela carrega.
 */

/** Rotas que não geram linha de log: ruído de infraestrutura, não evento de negócio. */
const SILENCIOSAS = [/\/health\//, /\/docs(-json)?($|\/)/, /\/favicon\.ico$/];

function ehSilenciosa(url: string): boolean {
  return SILENCIOSAS.some((re) => re.test(url));
}

/** Nível pelo desfecho: erro do servidor é `error`, recusa do cliente é `warn`. */
function nivelPara(status: number): 'info' | 'warn' | 'error' {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

/**
 * Caminho sem os valores. `/lojas/9f21.../notas/123` vira `/lojas/:id/notas/:id`.
 *
 * Sem isso, cada requisição vira uma rota diferente no olho de quem lê — e um id de
 * cliente acaba gravado no log sem necessidade.
 */
export function rotaGenerica(caminho: string): string {
  return caminho
    .split('?')[0]
    .split('/')
    .map((parte) => {
      if (!parte) return parte;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parte)) return ':id';
      if (/^\d+$/.test(parte)) return ':id';
      if (/^[0-9a-f]{24,}$/i.test(parte)) return ':id';
      return parte;
    })
    .join('/');
}

export function criarRequestLogMiddleware(log: EasySoftLogger) {
  return function requestLog(req: Request, res: Response, next: NextFunction): void {
    const corr = idDaRequisicao(req.headers as Record<string, unknown>);
    // Devolve o id ao chamador: é o que permite ao suporte pedir "qual o código do erro
    // que apareceu na tela?" e achar a requisição exata no log da API.
    res.setHeader('x-request-id', corr);

    if (ehSilenciosa(req.originalUrl || req.url || '')) {
      comCorrelacao(corr, () => next());
      return;
    }

    const inicio = process.hrtime.bigint();
    let registrado = false;

    const registrar = (): void => {
      if (registrado) return;
      registrado = true;
      const durMs = Number(process.hrtime.bigint() - inicio) / 1e6;
      const status = res.statusCode;

      log.emitir({
        level: nivelPara(status),
        ctx: 'HTTP',
        step: `${req.method} ${rotaGenerica(req.originalUrl || req.url || '')}`,
        msg: `${req.method} ${rotaGenerica(req.originalUrl || req.url || '')} → ${status}`,
        corr,
        durMs: Math.round(durMs),
        data: {
          status,
          // `ip` já vem do X-Forwarded-For (trust proxy está ligado no main.ts).
          ip: req.ip,
          // Só o produto/versão do cliente, não o user-agent inteiro (é longo e não ajuda).
          cliente: String(req.headers['user-agent'] || '').split(' ')[0] || undefined,
        },
      });
    };

    // `finish` cobre a resposta enviada; `close` cobre o cliente que desistiu no meio —
    // sem ele, requisição abandonada não deixaria rastro nenhum.
    res.on('finish', registrar);
    res.on('close', registrar);

    comCorrelacao(corr, () => next());
  };
}
