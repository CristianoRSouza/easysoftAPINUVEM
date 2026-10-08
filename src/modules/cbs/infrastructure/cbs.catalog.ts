/**
 * Catálogo das tabelas de referência do IBS/CBS (reforma tributária).
 *
 * São 14 tabelas que fazem a MESMA coisa: ler uma tabela de referência, renomear colunas
 * para o contrato e devolver. Escrever 14 métodos quase idênticos garante que, um dia,
 * um deles vai divergir dos outros por descuido. Aqui cada rota é um DESCRITOR, e o
 * service tem um caminho só.
 *
 * A contagem é `CBS_CATALOG.length` — não repita o número em prosa sem conferir. Ele já
 * esteve escrito como 19 aqui e como 15 no controller, com 14 entradas no array.
 *
 * ── Duas decisões que valem explicar ──────────────────────────────────────────
 *
 * **O rename acontece no SQL** (`validity_start as valid_from`), não num mapeador de
 * JavaScript. Mesma razão do detalhe da NFC-e: coluna que não existe quebra a consulta
 * na hora, em vez de virar `undefined` silencioso numa tela fiscal.
 *
 * **São dados GLOBAIS.** Não há `store_id` nem `company_id` em nenhuma destas tabelas —
 * é legislação, igual para todo mundo. Por isso as rotas são `@SkipTenant()`: exigir
 * `X-Company-Id` para ler a tabela de UFs seria teatro de segurança. A sessão continua
 * obrigatória; o que não faz sentido é o recorte por empresa.
 *
 * `raw_json` volta `null` em todas: era um campo do PostgreSQL da loja (o sync guarda o
 * payload cru da API do governo). Na nuvem esse metadado não existe. Mantido no contrato
 * para a tela não precisar de dois formatos.
 */

import type { CbsDescriptor } from '../domain/cbs-descriptor';
import { CBS_CST_TABLES } from './cbs-cst.catalog';
import { CBS_LEGISLATION_TABLES } from './cbs-legislation.catalog';
import { CBS_MUNICIPALITY_TABLES } from './cbs-municipality.catalog';
import { CBS_RATE_TABLES } from './cbs-rates.catalog';
import { CBS_TAX_CLASS_TABLES } from './cbs-tax-class.catalog';

export type { CbsDescriptor } from '../domain/cbs-descriptor';
export {
  CBS_MUNICIPALITY_BY_UF_SQL,
  CBS_MUNICIPALITY_WITH_RATE_BY_UF_SQL,
} from './cbs-municipality.catalog';

/**
 * A ORDEM é contrato: é a que aparece na descrição do Swagger, no `enum` do parâmetro
 * `key` e no `valid_keys` do 404. Os arquivos por assunto existem só para este não ter
 * 400 linhas — a sequência abaixo é a que o catálogo sempre teve.
 */
export const CBS_CATALOG: readonly CbsDescriptor[] = [
  ...CBS_RATE_TABLES,
  ...CBS_CST_TABLES,
  ...CBS_TAX_CLASS_TABLES,
  ...CBS_LEGISLATION_TABLES,
  ...CBS_MUNICIPALITY_TABLES,
];

export const findCbsDescriptor = (key: string): CbsDescriptor | undefined =>
  CBS_CATALOG.find((d) => d.key === key);

/** Descritor que o código cita pelo nome: se sumir do catálogo, é erro de programação e estoura no boot. */
function required(key: string): CbsDescriptor {
  const d = findCbsDescriptor(key);
  if (!d) throw new Error(`Catálogo CBS sem a tabela "${key}".`);
  return d;
}

/** As duas tabelas que `product-fiscal-ibscbs` consulta por código. */
export const CBS_TAX_CLASS_IBSCBS = required('tax-class-ibscbs');
export const CBS_TAX_CLASS_IBSCBS_INDICATOR = required('tax-class-ibscbs-indicator');
