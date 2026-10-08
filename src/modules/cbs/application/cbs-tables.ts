import { CBS_CATALOG } from '../infrastructure/cbs.catalog';

/**
 * O que a camada HTTP pode saber do catálogo: quais tabelas existem e como se chamam —
 * sem enxergar o SQL. É daqui que saem a lista de chaves do Swagger e o `valid_keys` do 404.
 */
export interface CbsTableInfo {
  /** Segmento da rota: `/v1/cbs/<key>`. */
  key: string;
  /** Descrição para o Swagger. */
  summary: string;
  /** Teto padrão de linhas. */
  defaultLimit: number;
}

export const CBS_TABLES: readonly CbsTableInfo[] = CBS_CATALOG.map(
  ({ key, summary, defaultLimit }) => ({ key, summary, defaultLimit }),
);

export const CBS_TABLE_KEYS: readonly string[] = CBS_TABLES.map((t) => t.key);
