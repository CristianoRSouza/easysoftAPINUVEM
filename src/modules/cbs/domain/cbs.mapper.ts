import {
  nullableNumber,
  nullableStr,
  str,
  toFloat,
  toIso,
} from '../../../common/mapping/coerce';
import type { Row } from '../../../db/queryable';
import type { CbsDescriptor } from './cbs-descriptor';

/**
 * Linha do banco → forma do fio, para as rotas de CBS. Funções puras.
 */

/**
 * Normaliza por CATEGORIA declarada no descritor, não campo a campo.
 *
 * Exportada por causa do `scripts/smoke-cbs-contrato.mjs`: aquele smoke confere o que a
 * TELA recebe, e a normalização faz parte disso (é ela que decide entre `null` e `""`).
 * Com uma cópia dele lá, o smoke poderia passar contra a cópia enquanto a rota real
 * devolve outra coisa — um teste que confirma a si mesmo.
 */
export function normalize(
  row: Row,
  d: Pick<CbsDescriptor, 'numbers' | 'nullables' | 'constants'>,
): Record<string, unknown> {
  const numbers = new Set(d.numbers ?? []);
  const nullables = new Set(d.nullables ?? []);
  const out: Record<string, unknown> = { ...(d.constants ?? {}) };

  for (const [k, v] of Object.entries(row)) {
    if (numbers.has(k)) {
      out[k] = nullables.has(k) ? nullableNumber(v) : toFloat(v);
    } else if (typeof v === 'boolean') {
      out[k] = v;
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else if (nullables.has(k)) {
      out[k] = nullableStr(v);
    } else {
      out[k] = str(v);
    }
  }
  return out;
}

export function mapMunicipality(r: Row) {
  // Mesmo contrato do modo Electron e da Admin API: `code`/`state_abbreviation`.
  // `municipality_code`/`uf` ficam junto por compatibilidade com quem já lê a rota.
  return {
    code: str(r.municipality_code),
    municipality_code: toFloat(r.municipality_code),
    name: str(r.name),
    state_abbreviation: str(r.uf),
    uf: str(r.uf),
    raw_json: null,
    updated_at: toIso(r.updated_at),
  };
}

export function mapMunicipalityWithRate(r: Row) {
  return {
    // A tela lê `m.code` (texto) — `municipality_code` era um nome que só existia aqui.
    // Vai junto por compatibilidade com quem já consumia a rota.
    code: str(r.code),
    municipality_code: toFloat(r.code),
    name: str(r.name),
    state_abbreviation: str(r.state_abbreviation),
    uf: str(r.state_abbreviation),
    raw_json: null,
    updated_at: toIso(r.updated_at),
    // Município sem alíquota publicada é normal — devolver 0 seria inventar um número
    // que a tela mostraria como "isento".
    reference_rate: nullableNumber(r.reference_rate),
    // A nuvem guarda uma alíquota só; a tela tem coluna de referência e de própria.
    // Repetir é o que o browser já fazia.
    own_rate_mun: nullableNumber(r.reference_rate),
    reference_date: nullableStr(r.reference_date),
    valid_from: nullableStr(r.valid_from),
    valid_to: nullableStr(r.valid_to),
    rate_updated_at: nullableStr(r.rate_updated_at),
  };
}

export function mapDatasetVersion(r: Row): Record<string, unknown> {
  return {
    id: toFloat(r.id),
    dataset_description: str(r.dataset_description),
    provider_app_version: str(r.provider_app_version),
    provider_db_version: str(r.provider_db_version),
    updated_at: toIso(r.updated_at),
  };
}
