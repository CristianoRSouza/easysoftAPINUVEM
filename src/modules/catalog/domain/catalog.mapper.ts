import { nullableStr, str, toFloat, toIso } from '../../../common/mapping/coerce';
import type { Product, ProductFiscal, Unit } from '../../../contract/catalog.schema';
import type { Row } from '../../../db/queryable';

/**
 * Linha do banco → forma do fio. Funções puras: não consultam, não lançam, não dependem
 * do Nest.
 *
 * `timestamptz` chega como Date (não há typeParser para ele); o fio é sempre ISO — é o
 * `toIso` de `created_at`/`updated_at`.
 */

export function mapProduct(r: Row): Product {
  return {
    id: String(r.id),
    description: str(r.description),
    // `numeric` chega como STRING (typeParser em db.service.ts, para casar com o
    // PostgREST). Converter aqui é o que mantém `sale_price` sendo número no contrato.
    sale_price: toFloat(r.sale_price),
    barcode: str(r.barcode),
    stock_quantity: toFloat(r.stock_quantity),
    image_url: nullableStr(r.image_url),
    is_active: Boolean(r.is_active),
    unit_name: nullableStr(r.unit_name),
    unit_is_fractional: r.unit_is_fractional != null ? Boolean(r.unit_is_fractional) : null,
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
  };
}

export function mapUnit(r: Row): Unit {
  return {
    id: String(r.id),
    legacy_code: toFloat(r.legacy_code),
    short_description: str(r.short_description),
    description: str(r.description),
    is_fractional: Boolean(r.is_fractional),
    is_active: Boolean(r.is_active),
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
  };
}

/**
 * Fiscal do produto: a linha passa como está (são ~40 colunas que mudam com a legislação);
 * a única garantia do contrato é `product_id` em texto. Sem linha, `null`.
 */
export function mapProductFiscal(row: Row | undefined, productId: string): ProductFiscal {
  if (!row) return null;
  return { ...row, product_id: String(row.product_id ?? productId) };
}

/**
 * Total da janela `count(*) over()`, que vem repetido em cada linha da página.
 * Sem linhas não há janela — total 0 é a resposta correta, não "desconhecido".
 */
export const totalOfPage = (rows: Row[]): number =>
  rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
