import { describe, expect, it, vi } from 'vitest';
import { CBS_TABLE_KEYS, CBS_TABLES } from '../src/modules/cbs/application/cbs-tables';
import { CbsService } from '../src/modules/cbs/application/cbs.service';
import { MAX_ROWS, parseOptionalInt, rowCap } from '../src/modules/cbs/domain/cbs-query.rule';
import { normalize } from '../src/modules/cbs/domain/cbs.mapper';
import { CBS_CATALOG } from '../src/modules/cbs/infrastructure/cbs.catalog';
import { CbsRepository } from '../src/modules/cbs/infrastructure/cbs.repository';
import type { DbService } from '../src/db/db.service';

function fakeDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows: [] };
    }),
  } as unknown as DbService;
  return { calls, svc: new CbsService(new CbsRepository(db)) };
}

describe('CBS — regras puras e a entrada da rota genérica', () => {
  describe('parseOptionalInt', () => {
    it('ausente, vazio ou não numérico: undefined', () => {
      for (const v of [undefined, null, '', '  ', 'abc', 'NaN']) {
        expect(parseOptionalInt(v)).toBeUndefined();
      }
    });

    it('inteiro, com as tolerâncias do parseInt', () => {
      expect(parseOptionalInt('35')).toBe(35);
      expect(parseOptionalInt(' 35 ')).toBe(35);
      expect(parseOptionalInt('35abc')).toBe(35);
      expect(parseOptionalInt('3.9')).toBe(3);
      expect(parseOptionalInt('-5')).toBe(-5);
      expect(parseOptionalInt('0')).toBe(0);
    });
  });

  describe('rowCap', () => {
    it('sem limite útil vale o padrão da tabela', () => {
      expect(rowCap(undefined, 120)).toBe(120);
      expect(rowCap(0, 120)).toBe(120);
      expect(rowCap(-5, 120)).toBe(120);
    });

    it('limite pedido passa; acima do teto absoluto é cortado', () => {
      expect(rowCap(7, 120)).toBe(7);
      expect(rowCap(999_999, 120)).toBe(MAX_ROWS);
    });
  });

  describe('normalize — por categoria do descritor', () => {
    const d = {
      numbers: ['rate', 'code'],
      nullables: ['rate', 'label'],
      constants: { raw_json: null },
    };

    it('número não anulável ausente vira 0; anulável continua null', () => {
      expect(normalize({ code: null, rate: null }, d)).toEqual({ raw_json: null, code: 0, rate: null });
      expect(normalize({ code: '35', rate: '0.10' }, d)).toMatchObject({ code: 35, rate: 0.1 });
    });

    it('texto: anulável continua null, o resto vira string vazia', () => {
      expect(normalize({ label: null, name: null }, d)).toMatchObject({ label: null, name: '' });
    });

    it('booleano e Date ganham de anulável/texto', () => {
      const out = normalize({ label: false, name: new Date('2026-07-30T12:00:00.000Z') }, d);
      expect(out.label).toBe(false);
      expect(out.name).toBe('2026-07-30T12:00:00.000Z');
    });

    it('descritor sem categorias: tudo vira texto e não há constantes', () => {
      expect(normalize({ a: 1, b: null }, {})).toEqual({ a: '1', b: '' });
    });
  });

  describe('o que a camada HTTP enxerga do catálogo', () => {
    it('as mesmas chaves, na MESMA ordem do catálogo (é a ordem do Swagger e do 404)', () => {
      expect(CBS_TABLE_KEYS).toEqual(CBS_CATALOG.map((d) => d.key));
      expect(CBS_TABLES.map((t) => t.key)).toEqual(CBS_TABLE_KEYS);
    });

    it('a ordem do catálogo é a de sempre', () => {
      expect(CBS_TABLE_KEYS).toEqual([
        'union-reference-rate',
        'state-reference-rate',
        'state',
        'cst-ibscbs',
        'cst-selective-tax',
        'cst-ibscbs-indicator',
        'tax-class-ibscbs',
        'tax-class-ibscbs-indicator',
        'tax-class-selective-tax',
        'tax-class-ibscbs-type',
        'selective-tax-ncm',
        'presumed-credit-rule',
        'legal-basis',
        'municipality-reference-rate',
      ]);
    });

    it('não leva o SQL junto', () => {
      for (const t of CBS_TABLES) expect(Object.keys(t).sort()).toEqual(['defaultLimit', 'key', 'summary']);
    });
  });

  describe('CbsService.table — a rota genérica, com a query crua', () => {
    it('chave desconhecida: 404 com a chave como veio e a lista das válidas', async () => {
      const { svc, calls } = fakeDb();
      await expect(svc.table(' nao-existe ', { limit: '10' })).rejects.toMatchObject({
        status: 404,
        response: {
          error: 'unknown_table',
          message: 'Tabela de referência desconhecida: " nao-existe ".',
          valid_keys: CBS_CATALOG.map((d) => d.key),
        },
      });
      expect(calls).toHaveLength(0);
    });

    it('a chave é aparada antes de procurar', async () => {
      const { svc, calls } = fakeDb();
      await svc.table(' state ');
      expect(calls[0].sql).toContain('public.pb_states');
      expect(calls[0].params).toEqual([40]);
    });

    it('limit e stateCode chegam como texto e viram número', async () => {
      const { svc, calls } = fakeDb();
      await svc.table('state-reference-rate', { limit: '10', stateCode: '35' });
      expect(calls[0].params).toEqual([10, 35]);
    });

    it('limit inválido cai no padrão; stateCode inválido vira null (sem filtro)', async () => {
      const { svc, calls } = fakeDb();
      await svc.table('state-reference-rate', { limit: 'abc', stateCode: '' });
      expect(calls[0].params).toEqual([120, null]);
    });

    it('stateCode é ignorado em tabela que não o usa', async () => {
      const { svc, calls } = fakeDb();
      await svc.table('state', { limit: '999999', stateCode: '35' });
      expect(calls[0].params).toEqual([MAX_ROWS]);
    });
  });
});
