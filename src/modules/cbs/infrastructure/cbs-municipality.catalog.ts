import type { CbsDescriptor } from '../domain/cbs-descriptor';
import { RAW } from './cbs-catalog.shared';

/** Alíquota de referência por município, e as duas consultas de município que EXIGEM a UF. */
export const CBS_MUNICIPALITY_TABLES: readonly CbsDescriptor[] = [
  {
    key: 'municipality-reference-rate',
    summary: 'Alíquota de referência por município (IBS municipal)',
    sql: `select city_code                          as municipality_code,
                 reference_date,
                 validity_start                     as valid_from,
                 validity_end                       as valid_to,
                 rate                               as reference_rate,
                 coalesce(updated_at, last_update)  as updated_at
            from public.pb_cbs_municipal_rates
           order by city_code
           limit $1`,
    numbers: ['municipality_code', 'reference_rate'],
    nullables: ['valid_from', 'valid_to', 'reference_rate'],
    constants: RAW,
    defaultLimit: 500,
  },
];

/**
 * `pb_cities` tem 5.573 linhas e `pb_cbs_municipal_rates` 11.140. Sem filtro por UF,
 * a tela puxaria o Brasil inteiro para escolher um município — por isso estas duas ficam
 * fora do catálogo genérico: exigem `uf` e não têm variante "traz tudo".
 */
export const CBS_MUNICIPALITY_BY_UF_SQL = `
  select code as municipality_code, name, state_acronym as uf, updated_at
    from public.pb_cities
   where upper(state_acronym) = upper($1)
   order by name`;

/**
 * Município + alíquotas, numa consulta (no browser eram duas + merge em JavaScript).
 *
 * `left join` simples, e não `lateral ... limit 1`: a tela tem filtro por ano e monta UMA
 * LINHA POR ALÍQUOTA (cidade × data de referência). Trazer só a mais recente faria o
 * filtro de 2025 vir vazio enquanto o app antigo mostra as linhas — a tabela some sem
 * nenhum erro aparecer. Cidade sem alíquota publicada continua rendendo uma linha, com as
 * colunas de alíquota nulas, para não desaparecer da listagem.
 */
export const CBS_MUNICIPALITY_WITH_RATE_BY_UF_SQL = `
  select c.code            as code,
         c.name            as name,
         c.state_acronym   as state_abbreviation,
         c.updated_at      as updated_at,
         r.rate            as reference_rate,
         r.reference_date  as reference_date,
         r.validity_start  as valid_from,
         r.validity_end    as valid_to,
         coalesce(r.updated_at, r.last_update) as rate_updated_at
    from public.pb_cities c
    left join public.pb_cbs_municipal_rates r on r.city_code = c.code
   where upper(c.state_acronym) = upper($1)
   order by c.name, r.reference_date desc`;
