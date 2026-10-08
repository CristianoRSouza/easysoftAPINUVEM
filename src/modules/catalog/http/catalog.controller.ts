import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireStore } from '../../../common/decorators';
import { CompanyId, StoreId } from '../../../common/http/request.decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiSessionAuth } from '../../../common/swagger';
import { UUID_RE } from '../../../common/validation/uuid';
import {
  productsPageQuerySchema,
  type ProductsPageQuery,
} from '../../../contract/catalog.schema';
import { CatalogService } from '../application/catalog.service';
import { DocProductFiscal, DocProducts, DocProductsPaged, DocUnits } from './catalog.docs';

/**
 * Catálogo — o mesmo contrato `/v1` que a Admin-API local já serve na loja, agora
 * também na nuvem. Mesmos paths, mesmos JSONs; muda só de onde o dado sai.
 *
 * Recorte de tenant por rota, e a diferença é de negócio, não de descuido:
 *   • produtos e fiscal são de UMA loja  → `@RequireStore()`
 *   • unidades são da EMPRESA            → só `X-Company-Id`
 */
@ApiTags('Catálogo')
@ApiSessionAuth()
@Controller()
export class CatalogController {
  constructor(private readonly service: CatalogService) {}

  @Get('products')
  @RequireStore()
  @DocProducts()
  async list(@CompanyId() companyId: string, @StoreId() storeId: string) {
    return { data: await this.service.listProducts({ companyId, storeId }) };
  }

  @Get('products/paged')
  @RequireStore()
  @DocProductsPaged()
  page(
    @CompanyId() companyId: string,
    @StoreId() storeId: string,
    @Query(new ZodValidationPipe(productsPageQuerySchema)) query: ProductsPageQuery,
  ) {
    return this.service.pageProducts({ companyId, storeId }, query);
  }

  @Get('products/:productId/fiscal')
  @RequireStore()
  @DocProductFiscal()
  async fiscal(@CompanyId() companyId: string, @Param('productId') productId: string) {
    if (!UUID_RE.test(String(productId ?? '').trim())) {
      throw new BadRequestException({ error: 'invalid_product', message: 'productId inválido.' });
    }
    return { data: await this.service.productFiscal(companyId, productId) };
  }

  @Get('units')
  @DocUnits()
  async units(@CompanyId() companyId: string) {
    return { data: await this.service.listUnits(companyId) };
  }
}
