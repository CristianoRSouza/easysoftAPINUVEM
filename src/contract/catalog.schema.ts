import { z } from 'zod';

/**
 * Catálogo — produtos, unidades e fiscal do produto.
 *
 * Forma copiada do que a UI já consome hoje (`Product`, `Unit`, `ProductFiscal` em
 * `mock-data.ts` do Manager-Web) e do que a Admin-API local já devolve em
 * `GET /v1/products`, `/v1/units` e `/v1/products/:id/fiscal`. Copiar em vez de
 * "melhorar" é proposital: a migração tem que ser invisível para a tela. Melhoria de
 * contrato é outro trabalho, depois, com as duas pontas já falando a mesma língua.
 */

export const productSchema = z.object({
  id: z.string(),
  description: z.string(),
  sale_price: z.number(),
  barcode: z.string(),
  stock_quantity: z.number(),
  image_url: z.string().nullable(),
  is_active: z.boolean(),
  /** Vem do JOIN com a unidade (`short_description`), não de uma coluna de produto. */
  unit_name: z.string().nullable(),
  /**
   * `is_fractional` da mesma unidade: a tela decide as casas do estoque por ele (KG com
   * decimais, UND inteiro). `null` quando o produto não tem unidade.
   */
  unit_is_fractional: z.boolean().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Product = z.infer<typeof productSchema>;

export const unitSchema = z.object({
  id: z.string(),
  legacy_code: z.number(),
  short_description: z.string(),
  description: z.string(),
  is_fractional: z.boolean(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Unit = z.infer<typeof unitSchema>;

/**
 * Filtros da listagem paginada. Os nomes vêm do que a tela de Produtos já usa
 * (`CloudProductsPageParams`), incluindo o par `from`/`to` de índices inclusivos —
 * herança do `range()` do PostgREST. Mantido para a tela não precisar recalcular nada.
 */
export const productsPageQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  activeFilter: z.enum(['all', 'active', 'inactive']).default('all'),
  stockFilter: z.enum(['all', 'in_stock', 'out_of_stock']).default('all'),
  priceMin: z.coerce.number().optional(),
  priceMax: z.coerce.number().optional(),
  sortKey: z
    .enum(['description', 'barcode', 'sale_price', 'stock_quantity', 'is_active'])
    .default('description'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  from: z.coerce.number().int().nonnegative().default(0),
  // Teto de 500 por página: sem ele, `to` grande vira um SELECT sem limite prático.
  to: z.coerce.number().int().nonnegative().default(49),
});
export type ProductsPageQuery = z.infer<typeof productsPageQuerySchema>;

export const productsPageResultSchema = z.object({
  rows: z.array(productSchema),
  total: z.number().int().nonnegative(),
});
export type ProductsPageResult = z.infer<typeof productsPageResultSchema>;

/**
 * Fiscal do produto. Deliberadamente **passthrough**: são ~40 colunas de regra fiscal
 * (ICMS/PIS/COFINS/IPI/CFOP) que a tela repassa como estão, e que mudam com a legislação.
 * Enumerar e manter cada uma aqui daria trabalho recorrente sem proteger nada — o
 * consumidor é a própria tela fiscal, que sabe o que procura. As duas garantias que
 * importam estão travadas: existe `product_id` e a resposta é objeto, não linha crua de
 * outra tabela.
 */
export const productFiscalSchema = z
  .object({ product_id: z.string() })
  .passthrough()
  .nullable();
export type ProductFiscal = z.infer<typeof productFiscalSchema>;
