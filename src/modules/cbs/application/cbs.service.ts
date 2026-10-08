import { Injectable, NotFoundException } from '@nestjs/common';
import type { CbsDescriptor } from '../domain/cbs-descriptor';
import { parseOptionalInt, rowCap } from '../domain/cbs-query.rule';
import {
  mapDatasetVersion,
  mapMunicipality,
  mapMunicipalityWithRate,
  normalize,
} from '../domain/cbs.mapper';
import {
  CBS_TAX_CLASS_IBSCBS,
  CBS_TAX_CLASS_IBSCBS_INDICATOR,
  findCbsDescriptor,
} from '../infrastructure/cbs.catalog';
import { CbsRepository } from '../infrastructure/cbs.repository';
import { CBS_TABLE_KEYS } from './cbs-tables';

/** `limit`/`stateCode` como vieram na query string — a conversão é do domínio, não da rota. */
export interface CbsTableRawQuery {
  limit?: string;
  stateCode?: string;
}

/**
 * Tabelas de referência do IBS/CBS. Um caminho de código para 19 rotas: o que muda
 * entre elas é o DESCRITOR, não a lógica.
 *
 * O SQL está no catálogo e em `CbsRepository` (com a nota sobre a ausência de tenant e
 * os tetos de linha); o que cada campo vira quando ausente, em `cbs.mapper.ts`.
 */
@Injectable()
export class CbsService {
  constructor(private readonly repository: CbsRepository) {}

  find(key: string): CbsDescriptor | undefined {
    return findCbsDescriptor(key);
  }

  /** Entrada da rota genérica: resolve a tabela pela chave e converte a query crua. */
  async table(key: string, query: CbsTableRawQuery = {}): Promise<Record<string, unknown>[]> {
    const d = this.find(String(key ?? '').trim());
    if (!d) {
      throw new NotFoundException({
        error: 'unknown_table',
        message: `Tabela de referência desconhecida: "${key}".`,
        valid_keys: CBS_TABLE_KEYS,
      });
    }
    return this.list(d, parseOptionalInt(query.limit), parseOptionalInt(query.stateCode));
  }

  async list(d: CbsDescriptor, limit?: number, stateCode?: number): Promise<Record<string, unknown>[]> {
    const rows = await this.repository.findTable(d, rowCap(limit, d.defaultLimit), stateCode);
    return rows.map((r) => normalize(r, d));
  }

  async municipalitiesByUf(uf: string) {
    return (await this.repository.findMunicipalitiesByUf(uf)).map(mapMunicipality);
  }

  async municipalitiesWithRateByUf(uf: string) {
    return (await this.repository.findMunicipalitiesWithRateByUf(uf)).map(mapMunicipalityWithRate);
  }

  /**
   * A classificação tributária e o indicador de UM código — o que a tela de Produtos usa
   * para resolver o `cClassTrib` de um item.
   *
   * Reaproveita os descritores do catálogo em vez de repetir o SQL: assim os apelidos e a
   * normalização são exatamente os mesmos das rotas de listagem, e um conserto de contrato
   * vale para os dois caminhos de uma vez.
   */
  async productFiscalIbsCbs(classCode: string) {
    const daClasse = CBS_TAX_CLASS_IBSCBS;
    const doIndicador = CBS_TAX_CLASS_IBSCBS_INDICATOR;
    const [classe, indicador] = await Promise.all([
      this.repository.findOneByClassCode(daClasse, classCode),
      this.repository.findOneByClassCode(doIndicador, classCode),
    ]);
    return {
      taxClass: classe ? normalize(classe, daClasse) : null,
      indicator: indicador ? normalize(indicador, doIndicador) : null,
    };
  }

  /**
   * Versão do dataset aberto do governo. Na loja é `cbs_open_dataset_version` (Sync-FB-PG);
   * na nuvem é `pb_cbs_dataset_version`, gravada pela Edge Function `sync-cbs-ct-cbs-ibs`
   * a partir do mesmo endpoint. Mesmo contrato nos dois modos.
   *
   * Banco sem a tabela (migração ainda não aplicada) devolve `[]` — quem trata é o repositório.
   */
  async openDatasetVersion(): Promise<Record<string, unknown>[]> {
    return (await this.repository.findOpenDatasetVersions()).map(mapDatasetVersion);
  }
}
