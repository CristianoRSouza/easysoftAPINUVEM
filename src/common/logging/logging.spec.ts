import { describe, expect, it, vi } from 'vitest';
import { EasySoftLogger, carimbo, sanitizar } from './easysoft-logger';
import { idDaRequisicao, comCorrelacao, correlacaoAtual, novoIdCorrelacao } from './request-context';
import { rotaGenerica } from './request-log.middleware';

/**
 * Testes do log da API — Padrão EasySoft, versão de contêiner.
 *
 * Aqui não se testa arquivo por dia nem retenção: a API escreve na SAÍDA PADRÃO e quem
 * recolhe é o Docker (o tamanho é limitado pelo `logging:` do compose). O que precisa
 * ficar de pé é o FORMATO, a redação de segredo e a correlação — que é o que amarra uma
 * chamada ao log do totem e do serviço fiscal.
 */

/** Captura o que foi escrito na saída, sem sujar a saída do teste. */
function capturar(fn: (log: EasySoftLogger) => void, opcoes = {}): string {
  const escrito: string[] = [];
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
    escrito.push(String(c));
    return true;
  });
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => {
    escrito.push(String(c));
    return true;
  });
  try {
    fn(new EasySoftLogger({ level: 'trace', ...opcoes }));
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return escrito.join('');
}

describe('formato', () => {
  it('carimba a hora LOCAL com fuso, igual aos outros produtos', () => {
    const t = carimbo(new Date(2026, 7, 1, 15, 4, 5, 123));
    expect(t).toMatch(/^2026-08-01 15:04:05\.123[+-]\d{2}:\d{2}$/);
  });

  it('escreve uma linha legível com contexto, passo e duração', () => {
    const saida = capturar((log) =>
      log.emitir({ level: 'info', ctx: 'HTTP', step: 'GET /lojas', msg: 'ok', durMs: 42, corr: 'api-abc' }),
    );
    expect(saida).toContain('[HTTP] GET /lojas | ok');
    expect(saida).toContain('corr=api-abc');
    expect(saida).toContain('dur=42ms');
  });

  it('em JSON, sai um objeto por linha', () => {
    const saida = capturar(
      (log) => log.emitir({ level: 'info', ctx: 'HTTP', msg: 'ok', corr: 'api-abc' }),
      { format: 'json' },
    );
    const obj = JSON.parse(saida.trim());
    expect(obj).toMatchObject({ lvl: 'info', ctx: 'HTTP', msg: 'ok', corr: 'api-abc', proc: 'api' });
  });

  it('erro e fatal vão para a saída de ERRO, o resto para a padrão', () => {
    const paraErro: string[] = [];
    const paraSaida: string[] = [];
    const e = vi.spyOn(process.stderr, 'write').mockImplementation((c) => (paraErro.push(String(c)), true));
    const o = vi.spyOn(process.stdout, 'write').mockImplementation((c) => (paraSaida.push(String(c)), true));
    try {
      const log = new EasySoftLogger({ level: 'trace' });
      log.emitir({ level: 'info', ctx: 'X', msg: 'normal' });
      log.emitir({ level: 'error', ctx: 'X', msg: 'ruim' });
    } finally {
      e.mockRestore();
      o.mockRestore();
    }
    expect(paraSaida.join('')).toContain('normal');
    expect(paraErro.join('')).toContain('ruim');
    expect(paraErro.join('')).not.toContain('normal');
  });

  it('um registro ocupa UMA linha, mesmo com quebra vinda de fora', () => {
    // Sem isto, um valor com quebra de linha forjaria um registro inteiro no log.
    const saida = capturar((log) =>
      log.emitir({ level: 'info', ctx: 'X', msg: 'linha1\nlvl=ERROR forjado' }),
    );
    expect(saida.trim().split('\n')).toHaveLength(1);
  });

  it('respeita o nível mínimo', () => {
    const saida = capturar((log) => log.emitir({ level: 'debug', ctx: 'X', msg: 'nao deve sair' }), {
      level: 'info',
    });
    expect(saida).toBe('');
  });

  it('registra a stack e a causa aninhada do erro', () => {
    const causa = new Error('conexão recusada');
    const erro = new Error('falha ao consultar');
    // Atribuído em vez de `new Error(msg, { cause })`: o `lib` deste tsconfig ainda não
    // conhece a assinatura de 2 argumentos, mas o campo existe em tempo de execução.
    (erro as Error & { cause?: unknown }).cause = causa;
    const saida = capturar((log) => log.emitir({ level: 'error', ctx: 'DB', msg: 'consulta', err: erro }));
    expect(saida).toContain('falha ao consultar');
    expect(saida).toContain('conexão recusada');
    expect(saida).toContain('stack');
  });
});

describe('segredo não vaza', () => {
  it('redige por NOME de campo, inclusive aninhado', () => {
    const limpo = sanitizar({
      usuario: 'joao',
      password: 'ec@193782#',
      headers: { authorization: 'Bearer abc', 'x-service-key': 'chave' },
    }) as Record<string, unknown>;

    expect(limpo.usuario).toBe('joao');
    expect(limpo.password).toBe('[REDIGIDO]');
    expect((limpo.headers as Record<string, unknown>).authorization).toBe('[REDIGIDO]');
  });

  it('o valor do segredo não aparece na linha escrita', () => {
    const saida = capturar((log) =>
      log.emitir({ level: 'info', ctx: 'AUTH', msg: 'login', data: { senha: 'ec@193782#' } }),
    );
    expect(saida).not.toContain('ec@193782#');
    expect(saida).toContain('[REDIGIDO]');
  });

  it('redige chave terminada em key — a service_role_key vazava', () => {
    // Achado por teste em 01/08/2026: `service_role_key` (acesso IRRESTRITO ao banco),
    // `anon_key` e `master_key` iam para o log em texto claro. A regra antiga exigia
    // que o nome COMECASSE com um termo conhecido. @see docs/PADRAO-LOGS.md §7.5
    const limpo = sanitizar({
      service_role_key: 'eyJ-ACESSO-TOTAL',
      anon_key: 'anon-123',
      master_key: 'mestre',
      host: 'db.exemplo',
    }) as Record<string, unknown>;

    expect(limpo.service_role_key).toBe('[REDIGIDO]');
    expect(limpo.anon_key).toBe('[REDIGIDO]');
    expect(limpo.master_key).toBe('[REDIGIDO]');
    expect(limpo.host).toBe('db.exemplo');
  });

  it('deixa passar os `key` que não são segredo', () => {
    // A lista de excecoes e curta de proposito: cada entrada e uma decisao de deixar
    // algo passar para o log.
    const limpo = sanitizar({ cacheKey: 'c1', idempotencyKey: 'i1' }) as Record<string, unknown>;
    expect(limpo.cacheKey).toBe('c1');
    expect(limpo.idempotencyKey).toBe('i1');
  });

  it('não estoura com objeto circular', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => capturar((log) => log.emitir({ level: 'info', ctx: 'X', msg: 'ciclo', data: circular }))).not.toThrow();
  });
});

describe('correlação', () => {
  it('aproveita o id que veio do cliente', () => {
    expect(idDaRequisicao({ 'x-request-id': 'totem-abc12345' })).toBe('totem-abc12345');
  });

  it('gera um id quando não veio nenhum', () => {
    expect(idDaRequisicao({})).toMatch(/^api-/);
  });

  it('higieniza id de fora — ele vai para o log', () => {
    // Sem limpar, um cliente injetaria quebra de linha e forjaria um registro.
    const sujo = idDaRequisicao({ 'x-request-id': 'abc\nlvl=ERROR forjado 12345' });
    expect(sujo).not.toContain('\n');
    expect(sujo).not.toContain(' ');
  });

  it('ignora id curto demais para ser útil', () => {
    expect(idDaRequisicao({ 'x-request-id': 'abc' })).toMatch(/^api-/);
  });

  it('o id fica disponível durante toda a requisição, atravessando await', async () => {
    await comCorrelacao('api-xyz', async () => {
      expect(correlacaoAtual()).toBe('api-xyz');
      await new Promise((r) => setTimeout(r, 5));
      expect(correlacaoAtual()).toBe('api-xyz');
    });
    expect(correlacaoAtual()).toBeUndefined();
  });

  it('ids gerados não se repetem', () => {
    const ids = new Set(Array.from({ length: 500 }, () => novoIdCorrelacao()));
    expect(ids.size).toBe(500);
  });
});

describe('rota genérica', () => {
  it('troca identificador por :id, para a rota não virar uma por requisição', () => {
    expect(rotaGenerica('/api/v1/stores/9f21a0b1-1111-2222-3333-444455556666/notes/42')).toBe(
      '/api/v1/stores/:id/notes/:id',
    );
  });

  it('descarta a query — pode levar dado do cliente', () => {
    expect(rotaGenerica('/api/v1/notes?cpf=12345678900')).toBe('/api/v1/notes');
  });

  it('preserva rota sem identificador', () => {
    expect(rotaGenerica('/api/v1/health/live')).toBe('/api/v1/health/live');
  });
});
