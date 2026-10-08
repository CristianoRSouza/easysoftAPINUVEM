import { describe, expect, it } from 'vitest';
import {
  mapProductFiscal,
  mapUnit,
  totalOfPage,
} from '../src/modules/catalog/domain/catalog.mapper';
import { MAX_PAGE_SIZE, pageWindow } from '../src/modules/catalog/domain/products-page.rule';

describe('catálogo — regras puras', () => {
  describe('pageWindow — from/to inclusivos viram limit/offset', () => {
    it('0..49 pede 50 linhas a partir do começo', () => {
      expect(pageWindow({ from: 0, to: 49 })).toEqual({ limit: 50, offset: 0 });
    });

    it('página do meio: o offset é o `from`', () => {
      expect(pageWindow({ from: 100, to: 149 })).toEqual({ limit: 50, offset: 100 });
    });

    it('from igual a to é uma linha', () => {
      expect(pageWindow({ from: 7, to: 7 })).toEqual({ limit: 1, offset: 7 });
    });

    it('to menor que from vira uma linha — nunca limit negativo', () => {
      expect(pageWindow({ from: 100, to: 10 })).toEqual({ limit: 1, offset: 100 });
    });

    it('página gigante é cortada no teto, sem mexer no offset', () => {
      expect(pageWindow({ from: 30, to: 999_999 })).toEqual({ limit: MAX_PAGE_SIZE, offset: 30 });
      expect(pageWindow({ from: 0, to: MAX_PAGE_SIZE - 1 }).limit).toBe(MAX_PAGE_SIZE);
      expect(pageWindow({ from: 0, to: MAX_PAGE_SIZE }).limit).toBe(MAX_PAGE_SIZE);
    });
  });

  describe('totalOfPage', () => {
    it('sem linhas não há janela: total 0', () => {
      expect(totalOfPage([])).toBe(0);
    });

    it('lê o total da primeira linha (int8 chega como string)', () => {
      expect(totalOfPage([{ total_count: '1287' }, { total_count: '1287' }])).toBe(1287);
    });

    it('linha sem a coluna vale 0', () => {
      expect(totalOfPage([{}])).toBe(0);
      expect(totalOfPage([{ total_count: null }])).toBe(0);
    });
  });

  describe('mapProductFiscal', () => {
    const PRODUCT = '55555555-5555-4555-8555-555555555555';

    it('sem linha devolve null', () => {
      expect(mapProductFiscal(undefined, PRODUCT)).toBeNull();
    });

    it('repassa a linha como está e garante product_id em texto', () => {
      expect(mapProductFiscal({ product_id: 42, cfop: '5102', icms_cst: null }, PRODUCT)).toEqual({
        product_id: '42',
        cfop: '5102',
        icms_cst: null,
      });
    });

    it('linha sem product_id usa o id pedido', () => {
      expect(mapProductFiscal({ cfop: '5102' }, PRODUCT)).toEqual({
        cfop: '5102',
        product_id: PRODUCT,
      });
    });
  });

  describe('mapUnit', () => {
    it('ausência vira valor neutro, não null', () => {
      expect(mapUnit({ id: 'u1' })).toEqual({
        id: 'u1',
        legacy_code: 0,
        short_description: '',
        description: '',
        is_fractional: false,
        is_active: false,
        created_at: '',
        updated_at: '',
      });
    });
  });
});
