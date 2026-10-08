import type { CbsDescriptor } from '../domain/cbs-descriptor';
import { RAW } from './cbs-catalog.shared';

/** Alíquotas de referência da União e dos estados, e a tabela de UFs. */
export const CBS_RATE_TABLES: readonly CbsDescriptor[] = [
  {
    key: 'union-reference-rate',
    summary: 'Alíquota de referência da União (CBS)',
    sql: `select reference_date,
                 validity_start                      as valid_from,
                 validity_end                        as valid_to,
                 rate                                as reference_rate,
                 rate                                as own_rate,
                 coalesce(updated_at, last_update)   as updated_at
            from public.pb_cbs_union_rates
           order by reference_date desc
           limit $1`,
    nullables: ['valid_to'],
    constants: RAW,
    defaultLimit: 24,
  },
  {
    key: 'state-reference-rate',
    summary: 'Alíquota de referência por estado (IBS estadual)',
    // $2 opcional: quando nulo, o `is not distinct from` não filtra nada.
    sql: `select state_code,
                 reference_date,
                 validity_start                      as valid_from,
                 validity_end                        as valid_to,
                 rate                                as reference_rate,
                 rate                                as own_rate,
                 coalesce(updated_at, last_update)   as updated_at
            from public.pb_cbs_state_rates
           where ($2::int is null or state_code = $2::int)
           order by reference_date desc
           limit $1`,
    numbers: ['state_code', 'reference_rate', 'own_rate'],
    nullables: ['valid_from', 'valid_to', 'reference_rate', 'own_rate'],
    constants: RAW,
    defaultLimit: 120,
  },
  {
    key: 'state',
    summary: 'Unidades federativas',
    sql: `select code, acronym as abbreviation, name, updated_at
            from public.pb_states
           order by name
           limit $1`,
    numbers: ['code'],
    constants: RAW,
    defaultLimit: 40,
  },
];
