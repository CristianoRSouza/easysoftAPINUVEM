import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from '../src/modules/catalog/application/catalog.service';
import { CatalogRepository } from '../src/modules/catalog/infrastructure/catalog.repository';
import { productSchema, unitSchema, productsPageResultSchema } from '../src/contract/catalog.schema';
import type { DbService } from '../src/db/db.service';

const STORE = '33333333-3333-4333-8333-333333333333';
const COMPANY = '11111111-1111-4111-8111-111111111111';
/** Loja + empresa dona dela, como o TenantGuard entrega. */
const TENANT = { companyId: COMPANY, storeId: STORE };
const PRODUCT = '55555555-5555-4555-8555-555555555555';

function fakeDb(rows: any[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows };
    }),
  } as unknown as DbService;
  return { db, calls, svc: new CatalogService(new CatalogRepository(db)) };
}

/** Linha crua como o driver `pg` entrega: numeric vira STRING, timestamptz vira Date. */
const rawProduct = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT,
  description: 'Refrigerante 350ml',
  sale_price: '7.50',
  barcode: '7891000000000',
  stock_quantity: '42.000',
  image_url: null,
  is_active: true,
  unit_name: 'UN',
  unit_is_fractional: false,
  created_at: new Date('2026-07-30T12:00:00.000Z'),
  updated_at: new Date('2026-07-30T12:00:00.000Z'),
  ...over,
});

const pageQuery = {
  activeFilter: 'all',
  stockFilter: 'all',
  sortKey: 'description',
  sortDir: 'asc',
  from: 0,
  to: 49,
} as const;

describe('CatalogService — recorte de tenant e forma do fio', () => {
  describe('o filtro de tenant não é opcional', () => {
    it('produtos: sempre filtrados pela loja', async () => {
      const { svc, calls } = fakeDb();
      await svc.listProducts(TENANT);
      expect(calls[0].sql).toContain('p.store_id = $1::uuid');
      expect(calls[0].params).toEqual([STORE, COMPANY]);
    });

    it('produtos paginados: a loja é o PRIMEIRO parâmetro, antes de qualquer filtro', async () => {
      const { svc, calls } = fakeDb();
      await svc.pageProducts(TENANT, { ...pageQuery, search: 'cola', priceMin: 1 });
      expect(calls[0].params[0]).toBe(STORE);
      expect(calls[0].sql).toContain('p.store_id = $1::uuid');
    });

    it('unidades: filtradas pela empresa (é cadastro de empresa, não de loja)', async () => {
      const { svc, calls } = fakeDb();
      await svc.listUnits(COMPANY);
      expect(calls[0].sql).toContain('company_id = $1::uuid');
      expect(calls[0].params).toEqual([COMPANY]);
    });

    it('fiscal: empresa E produto juntos — id de outra empresa não vira sonda', async () => {
      const { svc, calls } = fakeDb();
      await svc.productFiscal(COMPANY, PRODUCT);
      expect(calls[0].sql).toContain('company_id = $1::uuid');
      expect(calls[0].sql).toContain('product_id = $2::uuid');
      expect(calls[0].params).toEqual([COMPANY, PRODUCT]);
    });

    it('fiscal de produto inexistente/alheio devolve null, não erro', async () => {
      const { svc } = fakeDb([]);
      await expect(svc.productFiscal(COMPANY, PRODUCT)).resolves.toBeNull();
    });
  });

  describe('conversões — o que o driver entrega não é o que vai no fio', () => {
    it('numeric (string) vira número e timestamptz (Date) vira ISO', async () => {
      const { svc } = fakeDb([rawProduct()]);
      const [p] = await svc.listProducts(TENANT);
      expect(p.sale_price).toBe(7.5);
      expect(p.stock_quantity).toBe(42);
      expect(p.created_at).toBe('2026-07-30T12:00:00.000Z');
      expect(() => productSchema.parse(p)).not.toThrow();
    });

    it('nulos viram "" / null conforme o contrato — nunca undefined', async () => {
      const { svc } = fakeDb([
        rawProduct({
          description: null, barcode: null, sale_price: null,
          unit_name: null, unit_is_fractional: null, image_url: null,
        }),
      ]);
      const [p] = await svc.listProducts(TENANT);
      expect(p.description).toBe('');
      expect(p.sale_price).toBe(0);
      expect(p.unit_name).toBeNull();
      expect(p.unit_is_fractional).toBeNull();
      expect(() => productSchema.parse(p)).not.toThrow();
    });

    it('stock_quantity NULL vira 0 — é o caso DOMINANTE, não a exceção', async () => {
      // Medido em homolog (2026-07-30): 20790 de 23896 produtos têm stock_quantity NULL.
      // Se isso virasse NaN ou null, a coluna de estoque quebraria em 87% das linhas.
      const { svc } = fakeDb([rawProduct({ stock_quantity: null })]);
      const [p] = await svc.listProducts(TENANT);
      expect(p.stock_quantity).toBe(0);
      expect(Number.isNaN(p.stock_quantity)).toBe(false);
      expect(() => productSchema.parse(p)).not.toThrow();
    });

    it('unidade também respeita o contrato', async () => {
      const { svc } = fakeDb([
        {
          id: 'u1',
          legacy_code: '3',
          short_description: 'KG',
          description: 'Quilograma',
          is_fractional: true,
          is_active: true,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: null,
        },
      ]);
      const [u] = await svc.listUnits(COMPANY);
      expect(u.legacy_code).toBe(3);
      expect(u.updated_at).toBe('');
      expect(() => unitSchema.parse(u)).not.toThrow();
    });
  });

  describe('paginação', () => {
    it('total e linhas saem da MESMA consulta (não podem discordar)', async () => {
      const { svc, calls } = fakeDb([{ ...rawProduct(), total_count: '1287' }]);
      const out = await svc.pageProducts(TENANT, pageQuery);
      expect(calls).toHaveLength(1);
      expect(out.total).toBe(1287);
      expect(() => productsPageResultSchema.parse(out)).not.toThrow();
    });

    it('sem linhas → total 0', async () => {
      const { svc } = fakeDb([]);
      await expect(svc.pageProducts(TENANT, pageQuery)).resolves.toEqual({ rows: [], total: 0 });
    });

    it('from/to são inclusivos: 0..49 pede 50 linhas', async () => {
      const { svc, calls } = fakeDb();
      await svc.pageProducts(TENANT, pageQuery);
      expect(calls[0].params).toContain(50);
      expect(calls[0].params).toContain(0);
    });

    it('página gigante é limitada a 500 (teto do servidor, não confiança no cliente)', async () => {
      const { svc, calls } = fakeDb();
      await svc.pageProducts(TENANT, { ...pageQuery, from: 0, to: 999_999 });
      expect(calls[0].params).toContain(500);
    });

    it('to < from não gera limit negativo', async () => {
      const { svc, calls } = fakeDb();
      await svc.pageProducts(TENANT, { ...pageQuery, from: 100, to: 10 });
      expect(calls[0].params).toContain(1);
      expect(calls[0].params).toContain(100);
    });

    it('busca vai parametrizada e escapa % e _ (não vira varredura nem injeção)', async () => {
      const { svc, calls } = fakeDb();
      // `%` e `_` são curingas do LIKE: sem escapar, buscar "50%" casaria com quase tudo.
      // A aspa e o `--` provam que o termo não é concatenado no SQL.
      await svc.pageProducts(TENANT, { ...pageQuery, search: "50% _guaraná'--" });
      const like = calls[0].params.find((p) => typeof p === 'string' && p.includes('guaraná'));
      expect(like).toBe("%50\\% \\_guaraná'--%");
      expect(calls[0].sql).not.toContain('guaraná');
      expect(calls[0].sql).not.toContain('--');
      expect(calls[0].sql).toContain('ilike $3');
    });

    it('ordenação sai de mapa fechado — o valor do cliente nunca vira SQL', async () => {
      const { svc, calls } = fakeDb();
      await svc.pageProducts(TENANT, { ...pageQuery, sortKey: 'sale_price', sortDir: 'desc' });
      expect(calls[0].sql).toContain('order by p.sale_price desc');
      // Desempate estável: sem ele, duas páginas podem repetir ou pular linhas.
      expect(calls[0].sql).toContain('p.id');
    });

    it('filtros de estoque e preço entram como parâmetro, não interpolados', async () => {
      const { svc, calls } = fakeDb();
      await svc.pageProducts(TENANT, {
        ...pageQuery,
        stockFilter: 'in_stock',
        priceMin: 10,
        priceMax: 20,
      });
      expect(calls[0].sql).toContain('p.stock_quantity > 0');
      expect(calls[0].params).toContain(10);
      expect(calls[0].params).toContain(20);
      expect(calls[0].sql).not.toContain('10');
    });
  });
});
