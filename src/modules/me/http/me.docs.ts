import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiDocs, ApiSessionErrorResponses, ApiTenantHeaders } from '../../../common/swagger';

/**
 * Documentação OpenAPI do contexto do usuário — fora do controller. Cada `Doc*` equivale a
 * empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

export const DocContext = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Empresas e papéis do usuário logado',
      description:
        'Base para o seletor de empresa/loja do Manager. `system_admin`/`tech_admin` recebem TODAS ' +
        'as empresas; os demais só aquelas com acesso `approved` em `pb_user_company_access`. ' +
        'A lista sai do banco amarrada ao dono da sessão — o cliente não tem como pedir a de outro ' +
        'usuário. Não exige `X-Company-Id`: é esta rota que revela quais valores são válidos.',
    }),
    ApiResponse({
      status: 200,
      description: 'Identidade, papéis e empresas visíveis.',
      schema: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              email: { type: 'string', nullable: true, example: 'usuario@exemplo.com' },
            },
          },
          is_system_admin: { type: 'boolean' },
          is_company_admin: { type: 'boolean' },
          companies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                cnpj: { type: 'string', nullable: true, example: '00.000.000/0000-00' },
                name: { type: 'string', nullable: true, example: 'Empresa Exemplo' },
              },
            },
          },
        },
      },
    }),
    ApiSessionErrorResponses(),
  );

export const DocStores = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Lojas visíveis da empresa selecionada',
      description:
        'Admin (system/tech/company) enxerga todas as lojas da empresa; usuário comum só as que ' +
        'tem em `pb_user_store_access`. Loja com `is_deleted` não aparece para ninguém. ' +
        '`is_default` marca a loja de abertura: a marcada pelo usuário ou, para admin, a matriz ' +
        '(`headquarters`). A empresa vem do `X-Company-Id` e já foi validada pelo `TenantGuard`.',
    }),
    ApiTenantHeaders(),
    ApiResponse({
      status: 200,
      description: 'Lojas visíveis, ordenadas pelo código legado.',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            company_id: { type: 'string', format: 'uuid' },
            trade_name: { type: 'string', nullable: true, example: 'Loja Centro' },
            legacy_store_code: { type: 'string', example: '1' },
            store_type: { type: 'string', nullable: true, example: 'headquarters' },
            is_default: { type: 'boolean' },
          },
        },
      },
    }),
    ApiSessionErrorResponses(),
  );

export const DocAllStores = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Todas as lojas visíveis, de todas as empresas',
      description:
        'A lista do seletor "onde trabalhar". **`@SkipTenant` de propósito**: ela é usada ' +
        'ANTES de existir empresa escolhida, então exigir `X-Company-Id` seria exigir a ' +
        'resposta como pergunta.\n\n' +
        'Isso NÃO afrouxa o isolamento: o recorte não vem de cabeçalho nenhum, vem do dono ' +
        'da sessão — admin enxerga as lojas das empresas a que tem acesso, usuário comum só ' +
        'as de `pb_user_store_access`. Não há como pedir a loja de outra empresa: nada no ' +
        'pedido diz qual empresa.\n\n' +
        'Existe porque a alternativa era a tela chamar `/me/stores` uma vez por empresa — ' +
        'para um `system_admin` com centenas de empresas, centenas de requisições para ' +
        'desenhar um menu.',
    }),
    ApiResponse({
      status: 200,
      description: 'Lojas visíveis, agrupáveis por `company_id`.',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            company_id: { type: 'string', format: 'uuid' },
            trade_name: { type: 'string', nullable: true, example: 'Loja Centro' },
            legacy_store_code: { type: 'string', example: '1' },
            store_type: { type: 'string', nullable: true, example: 'headquarters' },
            is_default: { type: 'boolean' },
          },
        },
      },
    }),
    ApiSessionErrorResponses(),
  );
