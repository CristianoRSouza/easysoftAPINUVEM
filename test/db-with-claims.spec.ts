import { describe, expect, it, vi } from 'vitest';
import { DbService } from '../src/db/db.service';
import type { Env } from '../src/config/env';

/**
 * `withClaims` existe por causa de um `permission denied` que derrubava "ativar totem"
 * pela nuvem (homologação E produção, medido em 30/09/2026): o `withRls` troca o papel
 * para `authenticated`, que perdeu o EXECUTE de `cloud_set_totem_active` em 07/08/2026.
 * As RPCs de totem só precisam da IDENTIDADE (`auth.uid()` lê `request.jwt.claims`), não
 * do papel. Se alguém "unificar" os dois métodos, estes testes quebram.
 */
function comPoolFalso() {
  const sqls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      sqls.push({ sql, params });
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const env = {
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/x',
    DATABASE_CA_CERT: '',
    DATABASE_SSL_REJECT_UNAUTHORIZED: false,
    NODE_ENV: 'test',
  } as unknown as Env;
  const db = new DbService(env);
  (db as unknown as { pool: unknown }).pool = { connect: vi.fn(async () => client), end: vi.fn() };
  return { db, sqls, client };
}

describe('DbService.withClaims — identidade sem troca de papel', () => {
  it('põe só request.jwt.claims e NUNCA troca o role', async () => {
    const { db, sqls } = comPoolFalso();
    await db.withClaims({ sub: 'u-1', role: 'authenticated' }, async (c) => {
      await c.query('select 1');
    });
    const todas = sqls.map((s) => s.sql).join('\n');
    expect(todas).toContain("set_config('request.jwt.claims'");
    expect(todas).not.toMatch(/set_config\('role'|set\s+(local\s+)?role/i);
    expect(sqls.map((s) => s.sql)).toEqual([
      'begin',
      "select set_config('request.jwt.claims', $1, true)",
      'select 1',
      'commit',
    ]);
    // claims parametrizado — nunca concatenado na SQL
    expect(sqls[1].params).toEqual([JSON.stringify({ sub: 'u-1', role: 'authenticated' })]);
  });

  it('erro dentro: rollback e a conexão volta ao pool', async () => {
    const { db, sqls, client } = comPoolFalso();
    await expect(
      db.withClaims({ sub: 'u-1' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(sqls.map((s) => s.sql)).toContain('rollback');
    expect(sqls.map((s) => s.sql)).not.toContain('commit');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('o withRls continua trocando o papel (é para RLS de verdade, não para as RPCs de totem)', async () => {
    const { db, sqls } = comPoolFalso();
    await db.withRls({ sub: 'u-1' }, async () => undefined);
    expect(sqls[1].sql).toContain("set_config('role', 'authenticated', true)");
  });
});
