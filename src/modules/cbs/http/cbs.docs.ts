import { ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ApiDocs, ApiSessionErrorResponses } from '../../../common/swagger';
import { CBS_TABLES } from '../application/cbs-tables';

/**
 * Documentação OpenAPI das rotas de CBS/IBS. Cada `Doc*` equivale a empilhar os mesmos
 * decorators sobre o método, na mesma ordem.
 */

const listSchema = {
  type: 'object' as const,
  properties: {
    data: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
};

export const DocOpenDatasetVersion = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Versão do dataset aberto CBS/IBS',
      description:
        'Qual versão do dado do governo (`tabela-de-versao-ibs-e-cbs`) foi carregada na nuvem — ' +
        '`pb_cbs_dataset_version`, gravada pela Edge Function `sync-cbs-ct-cbs-ibs`. Mesmo formato ' +
        'da `cbs_open_dataset_version` da loja. Lista vazia se a carga ainda não rodou.',
    }),
    ApiResponse({
      status: 200,
      description: 'Versões, da mais recente para a mais antiga.',
      schema: listSchema,
    }),
    ApiSessionErrorResponses(),
  );

export const DocMunicipalityByUf = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Municípios de uma UF',
      description:
        'Exige `uf` — e **não há variante "traz tudo"**. `pb_cities` tem 5.573 registros; uma tela ' +
        'que puxe o Brasil inteiro para escolher um município trava o navegador antes de incomodar ' +
        'o banco.',
    }),
    ApiQuery({ name: 'uf', required: true, schema: { type: 'string', example: 'SP' } }),
    ApiResponse({ status: 200, description: 'Municípios da UF, por nome.', schema: listSchema }),
    ApiSessionErrorResponses(),
  );

export const DocMunicipalityWithRateByUf = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Municípios de uma UF com as alíquotas',
      description:
        'Município e alíquotas numa consulta (no browser eram duas, com o cruzamento em ' +
        'JavaScript). Devolve **uma linha por (município × data de referência)**, não só a ' +
        'mais recente: a tela filtra por ano, e trazer só a última faria 2025 vir vazio.\n\n' +
        '`reference_rate` vem `null` para município sem alíquota publicada — que é situação ' +
        'normal. Devolver `0` seria inventar um número que a tela mostraria como "isento".',
    }),
    ApiQuery({ name: 'uf', required: true, schema: { type: 'string', example: 'SP' } }),
    ApiResponse({ status: 200, description: 'Municípios com alíquota.', schema: listSchema }),
    ApiSessionErrorResponses(),
  );

export const DocProductFiscalIbsCbs = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Classificação tributária + indicadores de UM código',
      description:
        'A tela de Produtos resolve o `cClassTrib` de um item: precisa da classificação e do ' +
        'indicador **daquele código**, não da tabela inteira.\n\n' +
        'Existe como rota própria porque a rota genérica só aceita `limit`/`stateCode`. ' +
        'Mandar `?code=X` para ela não filtra nada — a resposta vem com as primeiras 300 ' +
        'linhas e a tela pega a primeira, exibindo a classificação de OUTRO produto sem ' +
        'nenhum erro aparecer. Mesmo contrato da Admin API, que já expunha este caminho.',
    }),
    ApiQuery({ name: 'classCode', required: true, schema: { type: 'string', example: '000001' } }),
    ApiResponse({ status: 200, description: 'Classificação e indicador, ou `null` em cada um.' }),
    ApiSessionErrorResponses(),
  );

export const DocTable = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Tabela de referência do IBS/CBS',
      description:
        'Um handler para as 15 tabelas simples, dirigido pelo catálogo. Chaves válidas:\n\n' +
        CBS_TABLES.map((d) => `- \`${d.key}\` — ${d.summary} (padrão ${d.defaultLimit} linhas)`).join('\n') +
        '\n\n`limit` sobrescreve o padrão, com teto absoluto de 2000 linhas por resposta. ' +
        '`stateCode` só é usado por `state-reference-rate`.\n\n' +
        '`raw_json` volta `null` em todas: era o payload cru da API do governo, guardado só no ' +
        'PostgreSQL da loja. Mantido no contrato para a tela não ter dois formatos.',
    }),
    ApiParam({
      name: 'key',
      description: 'Chave da tabela (ver lista na descrição).',
      schema: { type: 'string', enum: CBS_TABLES.map((d) => d.key) },
    }),
    ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', maximum: 2000 } }),
    ApiQuery({ name: 'stateCode', required: false, schema: { type: 'integer', example: 35 } }),
    ApiResponse({ status: 200, description: 'Linhas da tabela.', schema: listSchema }),
    ApiResponse({
      status: 404,
      description:
        'Chave desconhecida. O corpo lista as válidas — erro de digitação se resolve sem abrir a doc.',
    }),
    ApiSessionErrorResponses(),
  );
