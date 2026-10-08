/**
 * O descritor de uma tabela de referência do IBS/CBS: a consulta e o que o contrato espera
 * de cada campo. É tipo puro — o catálogo (`infrastructure/cbs.catalog.ts`) o preenche, e
 * `normalize` (`cbs.mapper.ts`) o lê.
 */
export interface CbsDescriptor {
  /** Segmento da rota: `/v1/cbs/<key>`. */
  key: string;
  /** SQL já com os aliases do contrato. `$1` = limite (quando `limited`). */
  sql: string;
  /** Campos que a tela usa como número; o resto vira string. */
  numbers?: readonly string[];
  /** Campos que podem ser `null` (o resto vira `''` quando ausente). */
  nullables?: readonly string[];
  /** Constantes do contrato que não existem no banco da nuvem. */
  constants?: Record<string, null>;
  /** Teto padrão de linhas. */
  defaultLimit: number;
  /** Descrição para o Swagger. */
  summary: string;
}
