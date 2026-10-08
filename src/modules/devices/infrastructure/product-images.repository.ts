import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';

/**
 * Imagens de produto por id — usada pela tela de Comandas para mostrar a foto do item.
 *
 * O `store_id` entra no WHERE junto dos ids: sem ele, uma lista de ids de outra loja
 * devolveria as imagens dela. Ids que não pertencem à loja simplesmente não voltam, em
 * vez de dar erro — a tela mostra o item sem foto, que é o comportamento de hoje.
 *
 * $1 = storeId, $2 = array de ids.
 */
export const PRODUCT_IMAGES_SQL = `
select id, image_url
  from public.pv_products
 where store_id = $1::uuid
   and id = any($2::uuid[])
   and image_url is not null`;

@Injectable()
export class ProductImagesRepository {
  constructor(private readonly db: DbService) {}

  async findByIds(
    storeId: string,
    ids: string[],
  ): Promise<Array<{ id: string; image_url: string }>> {
    const { rows } = await this.db.query<{ id: string; image_url: string }>(PRODUCT_IMAGES_SQL, [
      storeId,
      ids,
    ]);
    return rows;
  }
}
