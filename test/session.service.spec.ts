import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'crypto';
import { SessionService } from '../src/db/session.service';
import type { DbService } from '../src/db/db.service';
import type { Env } from '../src/config/env';

/**
 * A sessão opaca — o que sustenta TODA rota autenticada, e que não tinha teste.
 *
 * As regras aqui não são convenções: cada uma existe por um motivo que aparece em
 * produção se ela mudar.
 *
 *   • o banco guarda `sha256(token)`, nunca o token — vazamento de dump não vira sessão;
 *   • erro de banco responde 503, NUNCA 401 — senão um blip de infra desloga a frota;
 *   • token com ponto é negado sem ir ao banco — JWT tem ponto, base64url não;
 *   • sliding-expiry com throttle renova a validade sem gerar token novo;
 *   • o cache dispensa o banco por alguns segundos, e por isso vem DESLIGADO por padrão.
 *
 * Vários destes testes verificam o que o service **não** faz (não consulta, não renova,
 * não guarda o token em claro). É de propósito: essas são as partes que quebram calado.
 */

const USER = '55555555-5555-4555-8555-555555555555';
const TTL_HORAS = 12;
const THROTTLE_MIN = 30;

const env = (over: Partial<Env> = {}) =>
  ({
    SESSION_TTL_HOURS: TTL_HORAS,
    SESSION_RENEW_THROTTLE_MINUTES: THROTTLE_MIN,
    SESSION_CACHE_SECONDS: 0,
    ...over,
  }) as Env;

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

/** Banco falso: devolve as linhas combinadas e registra cada consulta. */
function fakeDb(rows: Array<Record<string, unknown>>, aoConsultar?: () => void) {
  const query = vi.fn(async (sql: string) => {
    aoConsultar?.();
    if (/^\s*(insert|update|delete)/i.test(sql)) return { rows: [] };
    return { rows };
  });
  return { db: { query } as unknown as DbService, query };
}

/** Linha de sessão com a validade posta a `restanteMs` do fim. */
const linha = (restanteMs: number) => ({
  user_id: USER,
  expires_at: new Date(Date.now() + restanteMs).toISOString(),
});

describe('SessionService.create — o banco nunca vê o token', () => {
  it('grava o sha256, não o token em claro', async () => {
    const { db, query } = fakeDb([]);
    const { token } = await new SessionService(db, env()).create(USER);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/insert into hub_sessions/i);
    expect(params).toContain(sha256(token));
    // O token em claro não pode aparecer em NENHUM parâmetro da escrita.
    expect(params.some((p) => String(p) === token)).toBe(false);
  });

  it('o token é opaco: base64url, sem ponto (é o que o distingue de um JWT)', async () => {
    const { db } = fakeDb([]);
    const { token } = await new SessionService(db, env()).create(USER);

    expect(token).not.toContain('.');
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('dois logins do mesmo usuário geram tokens diferentes', async () => {
    const { db } = fakeDb([]);
    const svc = new SessionService(db, env());
    const a = await svc.create(USER);
    const b = await svc.create(USER);
    expect(a.token).not.toBe(b.token);
  });

  it('a validade é agora + SESSION_TTL_HOURS', async () => {
    const { db } = fakeDb([]);
    const { expiresAt } = await new SessionService(db, env()).create(USER);
    const horas = (expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(horas).toBeCloseTo(TTL_HORAS, 1);
  });
});

describe('SessionService.validate — negar sem ir ao banco', () => {
  it('token com ponto (JWT) é negado SEM consultar o banco', async () => {
    const { db, query } = fakeDb([linha(60_000)]);
    await expect(new SessionService(db, env()).validate('a.b.c')).rejects.toMatchObject({
      response: { error: 'unauthorized' },
    });
    // O ponto é o discriminador barato: se isto consultar, o custo do JWT alheio é nosso.
    expect(query).not.toHaveBeenCalled();
  });

  it('token vazio é negado sem consultar', async () => {
    const { db, query } = fakeDb([]);
    await expect(new SessionService(db, env()).validate('')).rejects.toMatchObject({
      response: { error: 'unauthorized' },
    });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('SessionService.validate — fail-closed é 503, nunca 401', () => {
  it('erro de banco vira 503 service_unavailable', async () => {
    const db = {
      query: vi.fn(async () => {
        throw new Error('conexão perdida');
      }),
    } as unknown as DbService;

    // A distinção é o ponto: 401 faria o cliente DESLOGAR e a frota inteira cairia por
    // causa de um blip. 503 diz "tente de novo".
    await expect(new SessionService(db, env()).validate('token-opaco')).rejects.toMatchObject({
      status: 503,
      response: { error: 'service_unavailable' },
    });
  });

  it('sessão inexistente é 401 (aí sim), não 503', async () => {
    const { db } = fakeDb([]);
    await expect(new SessionService(db, env()).validate('token-opaco')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('sessão expirada é 401', async () => {
    const { db } = fakeDb([linha(-1000)]);
    await expect(new SessionService(db, env()).validate('token-opaco')).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('SessionService.validate — sliding-expiry com throttle', () => {
  /** Janela sem renovação: enquanto restar mais que (TTL − throttle). */
  const SEM_RENOVAR_MS = (TTL_HORAS * 60 - THROTTLE_MIN) * 60_000 + 60_000;

  it('sessão recém-criada NÃO é renovada (o throttle existe para isso)', async () => {
    const { db, query } = fakeDb([linha(SEM_RENOVAR_MS)]);
    const out = await new SessionService(db, env()).validate('token-opaco');

    expect(out.userId).toBe(USER);
    expect(out.renewedExpiresAt).toBeUndefined();
    // Uma consulta só: a leitura. Sem UPDATE — senão todo request escreveria no banco.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('vida restante abaixo do limite: renova a validade e avisa o guard', async () => {
    const { db, query } = fakeDb([linha(60_000)]);
    const out = await new SessionService(db, env()).validate('token-opaco');

    expect(out.renewedExpiresAt).toBeInstanceOf(Date);
    const horas = (out.renewedExpiresAt!.getTime() - Date.now()) / 3_600_000;
    expect(horas).toBeCloseTo(TTL_HORAS, 1);

    const update = query.mock.calls.find(([sql]) => /^update hub_sessions/i.test(String(sql)));
    expect(update).toBeDefined();
  });

  it('renovar NÃO troca o token — só estende a validade', async () => {
    const { db, query } = fakeDb([linha(60_000)]);
    await new SessionService(db, env()).validate('token-opaco');

    const [, params] = query.mock.calls.find(([sql]) =>
      /^update hub_sessions/i.test(String(sql)),
    ) as [string, unknown[]];
    // O UPDATE encontra a linha pelo hash do MESMO token: nada de token novo.
    expect(params[0]).toBe(sha256('token-opaco'));
  });
});

describe('SessionService — cache em memória', () => {
  it('com cache LIGADO, o segundo validate não consulta o banco', async () => {
    const { db, query } = fakeDb([linha(SEM_RENOVAR())]);
    const svc = new SessionService(db, env({ SESSION_CACHE_SECONDS: 30 }));

    await svc.validate('token-opaco');
    await svc.validate('token-opaco');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('com cache DESLIGADO (o default), toda validação vai ao banco', async () => {
    const { db, query } = fakeDb([linha(SEM_RENOVAR())]);
    const svc = new SessionService(db, env({ SESSION_CACHE_SECONDS: 0 }));

    await svc.validate('token-opaco');
    await svc.validate('token-opaco');
    // É esse o preço de revogar na hora — e por isso o default é 0 em qualquer topologia.
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('revoke apaga do banco E do cache: a sessão não sobrevive no processo', async () => {
    const { db, query } = fakeDb([linha(SEM_RENOVAR())]);
    const svc = new SessionService(db, env({ SESSION_CACHE_SECONDS: 30 }));

    await svc.validate('token-opaco');
    await svc.revoke('token-opaco');

    const del = query.mock.calls.find(([sql]) => /^delete from hub_sessions/i.test(String(sql)));
    expect(del).toBeDefined();
    expect((del as [string, unknown[]])[1][0]).toBe(sha256('token-opaco'));

    // Sem esta parte, o cache continuaria servindo a sessão recém-revogada.
    query.mockClear();
    await svc.validate('token-opaco').catch(() => undefined);
    expect(query).toHaveBeenCalled();
  });
});

/** Restante que NÃO dispara renovação — repetido aqui só para o bloco de cache ler bem. */
function SEM_RENOVAR(): number {
  return (TTL_HORAS * 60 - THROTTLE_MIN) * 60_000 + 60_000;
}
