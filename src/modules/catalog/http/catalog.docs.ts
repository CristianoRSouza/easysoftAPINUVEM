import { ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { ApiDocs, ApiSessionErrorResponses, ApiTenantHeaders, listOf } from '../../../common/swagger';

/**
 * Documentação OpenAPI das rotas de catálogo — fora do controller, para ele mostrar só o
 * que decide o comportamento (rota, guard, entrada, caso de uso).
 *
 * Cada `Doc*` equivale a empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

const productProperties = {
  id: { type: 'string', format: 'uuid' },
  description: { type: 'string', example: 'Refrigerante 350ml' },
  sale_price: { type: 'number', example: 7.5 },
  barcode: { type: 'string', example: '7891000000000' },
  stock_quantity: { type: 'number', example: 42 },
  image_url: { type: 'string', nullable: true },
  is_active: { type: 'boolean' },
  unit_name: { type: 'string', nullable: true, example: 'UN' },
  unit_is_fractional: { type: 'boolean', nullable: true, example: false },
  created_at: { type: 'string', format: 'date-time' },
  updated_at: { type: 'string', format: 'date-time' },
} as const;

export const DocProducts = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Produtos da loja',
      description:
        'Lista completa (teto de 1000, o mesmo que o browser já aplicava). Para catálogo grande ' +
        'use `GET /products/paged`, que filtra e ordena no banco. `unit_name` vem do JOIN com a ' +
        'unidade — não é coluna de produto. `sale_price` e `stock_quantity` saem como **número**: ' +
        'o driver devolve `numeric` como string e a conversão é feita aqui, não na tela.',
    }),
    ApiTenantHeaders(true),
    ApiResponse({
      status: 200,
      description: 'Produtos ordenados por descrição.',
      schema: listOf(productProperties),
    }),
    ApiSessionErrorResponses(),
  );

export const DocProductsPaged = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Produtos da loja, paginados e filtrados no banco',
      description:
        'Filtra, ordena e conta no Postgres — responde rápido em loja com dezenas de milhares de ' +
        'SKUs. `from`/`to` são índices **inclusivos** (herança do `range()` do PostgREST, mantida ' +
        'para a tela não recalcular nada); a página é limitada a 500 itens. `total` vem da mesma ' +
        'consulta que as linhas (`count(*) over()`), então não há como página e total discordarem. ' +
        'A busca cobre descrição OU código de barras, com `%` e `_` escapados.',
    }),
    ApiTenantHeaders(true),
    ApiResponse({
      status: 200,
      description: 'Página de produtos e o total que casa com os filtros.',
      schema: {
        type: 'object',
        properties: {
          rows: { type: 'array', items: { type: 'object', properties: productProperties } },
          total: { type: 'integer', example: 1287 },
        },
      },
    }),
    ApiSessionErrorResponses(),
  );

export const DocProductFiscal = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Regra fiscal do produto',
      description:
        'Devolve `data: null` quando não há regra cadastrada — e **também** quando o produto é de ' +
        'outra empresa. Isso é proposital: responder diferente transformaria a rota num verificador ' +
        'de existência de produto alheio. O corpo é repassado como está (são ~40 colunas de ' +
        'ICMS/PIS/COFINS/IPI/CFOP que mudam com a legislação).',
    }),
    ApiTenantHeaders(true),
    ApiParam({
      name: 'productId',
      description: 'UUID do produto.',
      schema: { type: 'string', format: 'uuid' },
    }),
    ApiResponse({
      status: 200,
      description: 'Regra fiscal, ou `null`.',
      schema: {
        type: 'object',
        properties: { data: { type: 'object', nullable: true, additionalProperties: true } },
      },
    }),
    ApiSessionErrorResponses(),
  );

export const DocUnits = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Unidades de medida da empresa',
      description:
        'Não exige `X-Store-Id`: unidade é cadastro da EMPRESA, compartilhado pelas lojas. ' +
        'Ordenadas pelo código legado, que é o que a tela mostra.',
    }),
    ApiTenantHeaders(),
    ApiResponse({
      status: 200,
      description: 'Unidades ordenadas por `legacy_code`.',
      schema: listOf({
        id: { type: 'string', format: 'uuid' },
        legacy_code: { type: 'integer', example: 1 },
        short_description: { type: 'string', example: 'UN' },
        description: { type: 'string', example: 'Unidade' },
        is_fractional: { type: 'boolean' },
        is_active: { type: 'boolean' },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
      }),
    }),
    ApiSessionErrorResponses(),
  );
