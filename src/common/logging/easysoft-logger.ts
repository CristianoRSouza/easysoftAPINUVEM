import { hostname } from 'node:os';
import type { LoggerService, LogLevel as NestLogLevel } from '@nestjs/common';

/**
 * Logger da API — Padrão EasySoft de Logs, adaptado para contêiner.
 * @see docs/PADRAO-LOGS.md
 *
 * ► POR QUE AQUI NÃO ENTRA O MOTOR DE ARQUIVO DOS OUTROS PRODUTOS
 *
 *   O Totem e os quatro serviços rodam no PC da loja, onde não existe nada que recolha
 *   log: por isso o motor lá escreve arquivo por dia, apaga sozinho e monta um `.zip`.
 *
 *   A API roda em CONTÊINER. Escrever arquivo dentro dele é errado — o contêiner é
 *   descartável e o arquivo some no próximo deploy. Quem recolhe é o Docker, então o
 *   certo é escrever na SAÍDA PADRÃO, e limitar o tamanho pelo `logging:` do compose
 *   (feito em `deploy/docker-compose.prod.yml`).
 *
 *   O que se mantém é o FORMATO: mesmos campos, mesma ordem, mesmo carimbo de hora dos
 *   outros cinco produtos. Assim o suporte lê tudo do mesmo jeito, e no dia em que os
 *   logs forem centralizados eles falam a mesma língua.
 *
 * ► FORMATO
 *
 *   `LOG_FORMAT=text` (padrão, legível no `docker logs`) ou `json` (para agregador) —
 *   a mesma variável e a mesma decisão dos outros produtos.
 */

/** Ordem de gravidade. Índice serve de filtro por mínimo. */
const NIVEIS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type NivelLog = (typeof NIVEIS)[number];

/** `LOG_LEVEL` do ambiente → índice. Desconhecido cai em `info`. */
function nivelMinimo(valor: string | undefined): number {
  const i = NIVEIS.indexOf(String(valor || '').toLowerCase() as NivelLog);
  return i >= 0 ? i : NIVEIS.indexOf('info');
}

/** Carimbo local com fuso: `2026-08-01 15:04:05.123-03:00`. Igual aos outros produtos. */
export function carimbo(d: Date = new Date(), separador: 'T' | ' ' = ' '): string {
  const p = (n: number, casas = 2) => String(n).padStart(casas, '0');
  const desloc = -d.getTimezoneOffset();
  const sinal = desloc >= 0 ? '+' : '-';
  const abs = Math.abs(desloc);
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${separador}` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}` +
    `${sinal}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

/**
 * Campos cujo VALOR nunca pode aparecer no log, mesmo que alguém os passe por engano.
 * É rede de segurança, não substituto de cuidado: a regra continua sendo não logar segredo.
 */
const CHAVES_SECRETAS =
  /^(pass(word)?|senha|secret|token|api[-_]?key|service[-_]?key|authorization|cookie|session|bearer|refresh)/i;

/**
 * Qualquer nome terminado em `key` — a regra que faltava.
 *
 * Achado por teste em 01/08/2026 no serviço de sincronização, e o mesmo buraco existia
 * aqui: `service_role_key` (a chave que dá acesso IRRESTRITO ao banco), `anon_key` e
 * `master_key` NÃO eram redigidas. A regra acima exige que o nome COMECE com um dos
 * termos, e `service_role_key` começa com "service" mas o padrão pedia `service_key`.
 *
 * Redigir por sufixo cobre também os nomes que ainda não existem. Redigir demais um
 * `cacheKey` é inofensivo; redigir de menos uma chave de serviço é um vazamento
 * permanente em disco. @see docs/PADRAO-LOGS.md §7.5
 */
const TERMINA_EM_KEY = /key$/i;

/** Nomes que terminam em `key` e NÃO são segredo. Curta de propósito. */
const CHAVES_BENIGNAS =
  /^(cache|sort|primary|foreign|partition|routing|row|idempotency|object|storage)[-_]?key$/i;

function ehSegredo(nome: string): boolean {
  if (CHAVES_BENIGNAS.test(nome)) return false;
  return CHAVES_SECRETAS.test(nome) || TERMINA_EM_KEY.test(nome);
}

const REDIGIDO = '[REDIGIDO]';

/** Um registro nunca pode ocupar duas linhas: quebra vinda de fora forjaria outro registro. */
function umaLinha(v: string): string {
  // Os caracteres de controle são o ALVO desta função, não um descuido: é justamente o
  // texto vindo de fora (mensagem de erro, campo de payload) que poderia carregar um
  // \n ou um \x1b e forjar um registro de log. O `no-control-regex` supõe que citá-los
  // num regex é engano — aqui é o ponto.
  // eslint-disable-next-line no-control-regex
  return v.replace(/\r\n|\r|\n/g, '\\n').replace(/[\u0000-\u001F\u007F]/g, ' ');
}

/** Redação por NOME de campo, recursiva, com teto de profundidade e de tamanho. */
export function sanitizar(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 4) return '[fundo]';
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === 'string') return valor.length > 2000 ? `${valor.slice(0, 2000)}…` : valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor)) {
    return valor.slice(0, 50).map((v) => sanitizar(v, profundidade + 1));
  }
  if (typeof valor === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      saida[k] = ehSegredo(k) ? REDIGIDO : sanitizar(v, profundidade + 1);
    }
    return saida;
  }
  return String(valor);
}

export interface RegistroLog {
  readonly level: NivelLog;
  /** De que parte da API veio: `HTTP`, `AUTH`, `NFCE`… */
  readonly ctx: string;
  /** Passo dentro do contexto: `login.ok`, `req`… */
  readonly step?: string;
  readonly msg: string;
  readonly data?: Record<string, unknown>;
  readonly err?: unknown;
  /** Id que amarra a mesma operação atravessando produtos. */
  readonly corr?: string;
  readonly durMs?: number;
}

function detalharErro(err: unknown): Record<string, unknown> | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    const saida: Record<string, unknown> = { nome: err.name, mensagem: err.message };
    if (err.stack) saida.stack = err.stack.split('\n').slice(0, 12).join('\n');
    const causa = (err as { cause?: unknown }).cause;
    if (causa) saida.causa = detalharErro(causa);
    return saida;
  }
  return { mensagem: String(err) };
}

/**
 * Escreve na saída padrão. `error`/`fatal` vão para a saída de ERRO, porque é o que o
 * Docker e os agregadores usam para separar o que merece alarme.
 */
export class EasySoftLogger implements LoggerService {
  private readonly min: number;
  private readonly formato: 'text' | 'json';
  private readonly base: Record<string, unknown>;

  constructor(opcoes: { level?: string; format?: string; app?: string; version?: string } = {}) {
    this.min = nivelMinimo(opcoes.level ?? process.env.LOG_LEVEL);
    this.formato =
      String(opcoes.format ?? process.env.LOG_FORMAT ?? 'text').toLowerCase() === 'json'
        ? 'json'
        : 'text';
    this.base = {
      app: opcoes.app ?? 'easyfood-api',
      ver: opcoes.version ?? process.env.npm_package_version ?? '0.0.0',
      proc: 'api',
      pid: process.pid,
      host: hostname(),
    };
  }

  emitir(reg: RegistroLog): void {
    if (NIVEIS.indexOf(reg.level) < this.min) return;

    const agora = new Date();
    const ctx = umaLinha(reg.ctx || 'API').toUpperCase();
    const step = umaLinha(reg.step || '-');
    const msg = umaLinha(reg.msg ?? '');
    const data = reg.data ? (sanitizar(reg.data) as Record<string, unknown>) : undefined;
    const erro = detalharErro(reg.err);

    let linha: string;
    if (this.formato === 'json') {
      linha = JSON.stringify({
        ts: carimbo(agora, 'T'),
        lvl: reg.level,
        ...this.base,
        ctx,
        step,
        msg,
        ...(reg.corr ? { corr: reg.corr } : {}),
        ...(reg.durMs !== undefined ? { dur_ms: reg.durMs } : {}),
        ...(data ? { data } : {}),
        ...(erro ? { err: erro } : {}),
      });
    } else {
      const partes = [
        `[${carimbo(agora)}]`,
        reg.level.toUpperCase().padEnd(5),
        `[${ctx}]`,
        step,
        '|',
        msg,
      ];
      if (reg.corr) partes.push(`| corr=${reg.corr}`);
      if (reg.durMs !== undefined) partes.push(`| dur=${reg.durMs}ms`);
      if (data) partes.push(`| data=${JSON.stringify(data)}`);
      linha = partes.join(' ');
      if (erro) linha += `\n    err: ${JSON.stringify(erro)}`;
    }

    const saida = reg.level === 'error' || reg.level === 'fatal' ? process.stderr : process.stdout;
    try {
      saida.write(`${linha}\n`);
    } catch {
      // Log nunca derruba a API. Se a saída quebrou (pipe fechado), não há para onde
      // avisar — engolir aqui é melhor do que matar o processo por causa de um log.
    }
  }

  // ── Interface do Nest ───────────────────────────────────────────────────────
  // O Nest chama `log/warn/error/debug/verbose`, sempre com o contexto no ÚLTIMO
  // argumento (o nome da classe). Traduzimos para o formato do padrão.

  private doNest(level: NivelLog, message: unknown, ...rest: unknown[]): void {
    const ctx = typeof rest[rest.length - 1] === 'string' ? (rest.pop() as string) : 'NEST';
    const extra = rest.length > 0 ? { detalhe: rest.map((r) => sanitizar(r)) } : undefined;
    this.emitir({ level, ctx, msg: typeof message === 'string' ? message : String(message), data: extra });
  }

  log(message: unknown, ...rest: unknown[]): void { this.doNest('info', message, ...rest); }
  warn(message: unknown, ...rest: unknown[]): void { this.doNest('warn', message, ...rest); }
  debug(message: unknown, ...rest: unknown[]): void { this.doNest('debug', message, ...rest); }
  verbose(message: unknown, ...rest: unknown[]): void { this.doNest('trace', message, ...rest); }
  fatal(message: unknown, ...rest: unknown[]): void { this.doNest('fatal', message, ...rest); }

  error(message: unknown, ...rest: unknown[]): void {
    // O Nest manda (mensagem, stack, contexto). A stack vira o erro do registro.
    const ctx = typeof rest[rest.length - 1] === 'string' && rest.length > 1 ? (rest.pop() as string) : 'NEST';
    const stack = rest.length > 0 ? rest[0] : undefined;
    this.emitir({
      level: 'error',
      ctx,
      msg: typeof message === 'string' ? message : String(message),
      err: typeof stack === 'string' ? { message, stack } : stack,
    });
  }

  setLogLevels?(_levels: NestLogLevel[]): void {
    // O nível vem de `LOG_LEVEL`, uma fonte só — ver docs/PADRAO-LOGS.md §6.1.
  }
}
