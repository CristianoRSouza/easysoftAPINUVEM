import { Injectable } from '@nestjs/common';
import type {
  Product,
  ProductFiscal,
  ProductsPageQuery,
  ProductsPageResult,
  Unit,
} from '../../../contract/catalog.schema';
import { mapProduct, mapProductFiscal, mapUnit, totalOfPage } from '../domain/catalog.mapper';
import { pageWindow } from '../domain/products-page.rule';
import { CatalogRepository, type StoreScope } from '../infrastructure/catalog.repository';

/**
 * Catálogo na nuvem: produtos (por LOJA), unidades (por EMPRESA) e fiscal do produto.
 *
 * Cada método é um caso de uso de leitura: busca no repositório e entrega na forma do
 * fio. `companyId`/`storeId` chegam aqui já validados pelo `TenantGuard`; este service
 * confia neles e em mais nada vindo do cliente. O SQL (e o recorte de tenant) está em
 * `CatalogRepository`; o que cada campo vira quando ausente, em `catalog.mapper.ts`.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  async listProducts(tenant: StoreScope): Promise<Product[]> {
    return (await this.repository.findProducts(tenant)).map(mapProduct);
  }

  async pageProducts(tenant: StoreScope, q: ProductsPageQuery): Promise<ProductsPageResult> {
    const rows = await this.repository.findProductsPage(tenant, q, pageWindow(q));
    return { rows: rows.map(mapProduct), total: totalOfPage(rows) };
  }

  /** Unidades são da EMPRESA, não da loja — por isso esta rota não exige `X-Store-Id`. */
  async listUnits(companyId: string): Promise<Unit[]> {
    return (await this.repository.findUnits(companyId)).map(mapUnit);
  }

  async productFiscal(companyId: string, productId: string): Promise<ProductFiscal> {
    const row = await this.repository.findProductFiscal(companyId, productId);
    return mapProductFiscal(row, productId);
  }
}
