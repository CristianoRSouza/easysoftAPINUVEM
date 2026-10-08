import type { QueryResultRow } from 'pg';

/**
 * Quem sabe consultar: o pool (`DbService`) ou o client de uma transação aberta.
 *
 * Repositório que participa de transação recebe um `Queryable` em vez de falar direto
 * com o `DbService`: usar o pool ali pegaria OUTRA conexão, fora da transação, e a
 * leitura enxergaria um estado que não é o que está sendo gravado.
 */
export interface Queryable {
  query<T extends QueryResultRow = Row>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

/** Linha crua, antes de qualquer mapeamento. A coluna existe ou não — o mapper decide. */
export type Row = Record<string, unknown>;
