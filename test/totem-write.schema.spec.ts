import { describe, expect, it } from 'vitest';
import { totemCreateSchema, totemUpdateSchema } from '../src/contract/totem-write.schema';

/**
 * A tela de totem devolve no PATCH os valores que leu de `GET /v1/totems`. Se o schema
 * declara um tipo diferente do que a coluna guarda, TODO salvamento volta 400 — e foi o
 * que aconteceu com `printer_cut_type` (texto no schema, inteiro no banco).
 */
describe('totem-write schema — tipos batem com o banco', () => {
  it('printer_cut_type aceita o inteiro que a coluna guarda', () => {
    expect(totemUpdateSchema.safeParse({ printer_cut_type: 0 }).success).toBe(true);
    expect(totemCreateSchema.safeParse({ totem_name: 'TOTEM-01', printer_cut_type: 1 }).success).toBe(true);
  });

  it('printer_cut_type recusa texto', () => {
    expect(totemUpdateSchema.safeParse({ printer_cut_type: 'total' }).success).toBe(false);
  });
});
