import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import type { Row } from '../../../db/queryable';
import type { CbsDescriptor } from '../domain/cbs-descriptor';
import {
  CBS_MUNICIPALITY_BY_UF_SQL,
  CBS_MUNICIPALITY_WITH_RATE_BY_UF_SQL,
} from './cbs-municipality.catalog';

const OPEN_DATASET_VERSION_SQL = `
  select id, dataset_description, provider_app_version, provider_db_version, updated_at
  from public.pb_cbs_dataset_version
  order by updated_at desc, id desc
  limit 50`;

/** `undefined_table` do Postgres: a relação consultada não existe neste banco. */
const PG_UNDEFINED_TABLE = '42P01';

const pgErrorCode = (err: unknown): unknown =>
  typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;

/**
 * Leituras das tabelas de referência do IBS/CBS. O SQL de cada tabela vem do catálogo
 * (`cbs.catalog.ts`); aqui está só o que é comum: parâmetros e execução.
 *
 * Não há filtro de tenant aqui porque não há tenant nos dados — é legislação, igual
 * para todas as empresas. O que existe é teto de linhas: `pb_cities` tem 5.573 registros
 * e `pb_cbs_municipal_rates` 11.140, e uma tela que peça "tudo" sem limite trava o
 * navegador antes de travar o banco.
 */
@Injectable()
export class CbsRepository {
  constructor(private readonly db: DbService) {}

  async findTable(
    d: Pick<CbsDescriptor, 'sql'>,
    cap: number,
    stateCode?: number,
  ): Promise<Row[]> {
    // O descritor de estado é o único com segundo parâmetro; passar sempre mantém um
    // caminho de código só, e o `$2::int is null` neutraliza quando não há filtro.
    const params: unknown[] = d.sql.includes('$2') ? [cap, stateCode ?? null] : [cap];
    const { rows } = await this.db.query<Row>(d.sql, params);
    return rows;
  }

  async findMunicipalitiesByUf(uf: string): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(CBS_MUNICIPALITY_BY_UF_SQL, [uf]);
    return rows;
  }

  async findMunicipalitiesWithRateByUf(uf: string): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(CBS_MUNICIPALITY_WITH_RATE_BY_UF_SQL, [uf]);
    return rows;
  }

  /** A linha de UM `class_code`, tirada do SQL de listagem do descritor. */
  async findOneByClassCode(
    d: Pick<CbsDescriptor, 'sql'>,
    classCode: string,
  ): Promise<Row | undefined> {
    const { rows } = await this.db.query<Row>(porCodigo(d.sql), [classCode]);
    return rows[0];
  }

  /**
   * Banco sem a tabela (migração ainda não aplicada) devolve `[]` — a tela mostra "nenhuma
   * versão", que é a verdade, em vez de um 500 que derrubaria o card.
   */
  async findOpenDatasetVersions(): Promise<Row[]> {
    try {
      const { rows } = await this.db.query<Row>(OPEN_DATASET_VERSION_SQL);
      return rows;
    } catch (err) {
      if (pgErrorCode(err) === PG_UNDEFINED_TABLE) return [];
      throw err;
    }
  }
}

/**
 * Transforma o SQL de listagem do catálogo em "uma linha, por código".
 *
 * Filtra por FORA, num subselect, em vez de enfiar um `where` dentro do SQL original: a
 * consulta da classificação usa prefixo de tabela (`c.code`, por causa do join) e a do
 * indicador não. Um filtro interno precisaria conhecer a forma de cada uma; aqui basta o
 * APELIDO do contrato — `class_code` — que as duas entregam por definição.
 *
 * O `limit $1` de dentro vira teto fixo, e `$1` passa a ser o código procurado.
 */
function porCodigo(sql: string): string {
  const interno = sql.trim().replace(/limit\s+\$1$/i, 'limit 2000');
  return `select * from (${interno}) t where t.class_code = $1 limit 1`;
}
