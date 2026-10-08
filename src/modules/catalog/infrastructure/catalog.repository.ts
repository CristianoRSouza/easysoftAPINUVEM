import { Injectable } from '@nestjs/common';
import type { ProductsPageQuery } from '../../../contract/catalog.schema';
import { DbService } from '../../../db/db.service';
import type { Row } from '../../../db/queryable';
import type { PageWindow } from '../domain/products-page.rule';

/** Teto da listagem "tudo" — mesmo valor que o browser já usava em Cloud Mode. */
const MAX_LIST = 1000;

/**
 * Colunas de ordenação permitidas. É um MAPA, não interpolação: o valor já vem de um
 * enum do Zod, mas fragmento de SQL montado com string do cliente é o tipo de coisa que
 * um dia deixa de ser validada em cima e vira injeção. Aqui não tem como.
 */
const SORT_COLUMNS: Record<ProductsPageQuery['sortKey'], string> = {
  description: 'p.description',
  barcode: 'p.barcode',
  sale_price: 'p.sale_price',
  stock_quantity: 'p.stock_quantity',
  is_active: 'p.is_active',
};

const PRODUCT_COLUMNS = `
  p.id, p.description, p.sale_price, p.barcode, p.stock_quantity, p.image_url,
  p.is_active, p.created_at, p.updated_at, u.short_description as unit_name,
  u.is_fractional as unit_is_fractional`;

/** Os filtros da listagem paginada — a janela (`from`/`to`) chega já resolvida, à parte. */
export type ProductsPageFilters = Pick<
  ProductsPageQuery,
  'search' | 'activeFilter' | 'stockFilter' | 'priceMin' | 'priceMax' | 'sortKey' | 'sortDir'
>;

/**
 * Leituras de catálogo no Supabase: produtos (por LOJA), unidades (por EMPRESA) e fiscal
 * do produto.
 *
 * O recorte de tenant não é opcional nem "defensivo" — é o filtro que substitui a RLS
 * que protegia estas tabelas quando o browser as consultava direto. `companyId`/`storeId`
 * chegam aqui já validados pelo `TenantGuard`.
 *
 * Nomes de tabela divergem do banco da loja de propósito (`pv_products` × `products`):
 * o que precisa bater entre as duas APIs é o JSON de saída, não o schema.
 */
/** Loja + a empresa dona dela — as duas já conferidas pelo `TenantGuard`. */
export interface StoreScope {
  companyId: string;
  storeId: string;
}

/**
 * Recorte dos produtos de UMA loja. `$1` = loja, `$2` = empresa.
 *
 * ── Por que a empresa entra, se a loja já basta para a resposta ────────────────
 * `pv_products` (~290 mil linhas, 650 MB) **não tem índice por `store_id`** — os índices
 * são todos por `company_id`. Filtrando só por loja o Postgres varria a tabela inteira:
 * medido em produção (08/10/2026), 265 ms para contar os produtos ativos de uma loja,
 * contra 26 ms com a empresa no filtro (`idx_products_company_active_true`).
 *
 * O resultado é o mesmo: todo produto carrega a empresa dona da sua loja (0 divergências
 * em 285 mil linhas, conferido no mesmo dia), e o `TenantGuard` só deixa passar loja que
 * pertence à empresa do header.
 */
const PRODUCTS_OF_STORE = 'p.store_id = $1::uuid and p.company_id = $2::uuid';

@Injectable()
export class CatalogRepository {
  constructor(private readonly db: DbService) {}

  async findProducts(tenant: StoreScope): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select ${PRODUCT_COLUMNS}
         from public.pv_products p
         left join public.pv_product_units u on u.id = p.unit_id
        where ${PRODUCTS_OF_STORE}
        order by p.description
        limit ${MAX_LIST}`,
      [tenant.storeId, tenant.companyId],
    );
    return rows;
  }

  /** Cada linha traz `total_count`: o total que casa com os filtros, não só o da página. */
  async findProductsPage(
    tenant: StoreScope,
    q: ProductsPageFilters,
    window: PageWindow,
  ): Promise<Row[]> {
    const where: string[] = [PRODUCTS_OF_STORE];
    const params: unknown[] = [tenant.storeId, tenant.companyId];
    const add = (value: unknown) => `$${params.push(value)}`;

    if (q.activeFilter === 'active') where.push('p.is_active = true');
    else if (q.activeFilter === 'inactive') where.push('p.is_active = false');

    if (q.stockFilter === 'in_stock') where.push('p.stock_quantity > 0');
    else if (q.stockFilter === 'out_of_stock') where.push('p.stock_quantity <= 0');

    if (q.priceMin != null && Number.isFinite(q.priceMin)) {
      where.push(`p.sale_price >= ${add(q.priceMin)}::numeric`);
    }
    if (q.priceMax != null && Number.isFinite(q.priceMax)) {
      where.push(`p.sale_price <= ${add(q.priceMax)}::numeric`);
    }

    const term = (q.search ?? '').trim();
    if (term) {
      // Descrição OU código de barras. `%`/`_` são escapados: sem isso, um usuário
      // buscando "50%" faria uma varredura que casa com quase tudo.
      const like = `%${term.replace(/([%_\\])/g, '\\$1')}%`;
      const p = add(like);
      where.push(`(p.description ilike ${p} or p.barcode ilike ${p})`);
    }

    const orderBy = `${SORT_COLUMNS[q.sortKey]} ${q.sortDir === 'desc' ? 'desc' : 'asc'}`;

    // Janela `count(*) over()`: total e página na MESMA ida ao banco. Duas queries
    // separadas podem discordar se alguém gravar no meio.
    const { rows } = await this.db.query<Row>(
      `select ${PRODUCT_COLUMNS}, count(*) over() as total_count
         from public.pv_products p
         left join public.pv_product_units u on u.id = p.unit_id
        where ${where.join(' and ')}
        order by ${orderBy}, p.id
        limit ${add(window.limit)} offset ${add(window.offset)}`,
      params,
    );
    return rows;
  }

  /** Unidades são da EMPRESA, não da loja — por isso esta rota não exige `X-Store-Id`. */
  async findUnits(companyId: string): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select id, legacy_code, short_description, description, is_fractional,
              is_active, created_at, updated_at
         from public.pv_product_units
        where company_id = $1::uuid
        order by legacy_code
        limit ${MAX_LIST}`,
      [companyId],
    );
    return rows;
  }

  /**
   * Fiscal do produto. O filtro por `company_id` **junto** do `product_id` é o que impede
   * usar um id de produto de outra empresa como sonda: id errado devolve `null`, não a
   * linha alheia.
   */
  async findProductFiscal(companyId: string, productId: string): Promise<Row | undefined> {
    const { rows } = await this.db.query<Row>(
      `select * from public.vw_nfce_product_fiscal
        where company_id = $1::uuid and product_id = $2::uuid
        limit 1`,
      [companyId, productId],
    );
    return rows[0];
  }
}
