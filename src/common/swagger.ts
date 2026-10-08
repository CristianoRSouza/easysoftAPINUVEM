/**
 * Helpers de OpenAPI/Swagger para os controllers da EasyFood API.
 *
 * Adapta o padrão do EasyERP-Sync (`apps/api/src/common/swagger.ts`) à REALIDADE
 * desta API:
 *  - A IDENTIDADE vem sempre da SESSÃO (`req.user.id`, populado pelo `AuthGuard`) e nunca
 *    do cliente. O TENANT (empresa/loja) vem em header `X-Company-Id` / `X-Store-Id`, mas
 *    é ALVO e não credencial: o `TenantGuard` confere o vínculo no banco antes de deixar
 *    passar (`has_company_access` / `is_company_admin_for_store` / `pb_user_store_access`).
 *    Use `ApiTenantHeaders()` para documentá-los. Rotas de identidade e as que já recebem
 *    o `store_id` no path/body dispensam o header com `@SkipTenant()`.
 *  - São TRÊS caminhos de auth (um único `AuthGuard` global com ramos ordenados):
 *      `@Public()`      → rota aberta (health, login, logout, recovery)
 *      `@ServiceOnly()` → máquina-a-máquina, header `X-Service-Key`
 *      default          → sessão de usuário: cookie httpOnly OU Bearer opaco
 *    Por isso há três security schemes: `session-cookie`, `session-bearer` e
 *    `service-key` — os dois primeiros andam juntos (são a MESMA sessão, em dois
 *    transportes) e o helper `ApiSessionAuth()` declara ambos como alternativas.
 *
 * Como a validação é Zod (não class-validator), os schemas de request/response são
 * declarados INLINE nos decorators — não em classes DTO com `@ApiProperty`. Sem
 * `@ApiBody`/`@ApiQuery`/`@ApiParam` explícito o parâmetro simplesmente NÃO aparece
 * no Swagger UI.
 *
 * Uso num controller de sessão:
 *   @ApiTags("Totens")
 *   @ApiSessionAuth()
 *   @Controller("totems")
 *   export class TotemsController { ... }
 * e em cada rota: `@ApiSessionErrorResponses()` para os erros padrão.
 */
import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

/** Nomes lógicos dos security schemes (referenciados nos decorators e no main.ts). */
export const SEC_SESSION_COOKIE = 'session-cookie';
export const SEC_SESSION_BEARER = 'session-bearer';
export const SEC_SERVICE_KEY = 'service-key';

/**
 * Nome do cookie de sessão exibido no documento. O valor REAL é `SESSION_COOKIE_NAME`
 * (env) — este é só o default, usado quando o documento é gerado sem env carregado.
 *
 * Reexportado de `session-cookie.ts`, que é a fonte única: o literal já esteve escrito
 * aqui, no `env.ts` e no throttler ao mesmo tempo.
 */
export { DEFAULT_SESSION_COOKIE_NAME } from './session-cookie';

/**
 * Auth de USUÁRIO (ramo default do `AuthGuard`). Declara os dois transportes da mesma
 * sessão opaca: cookie httpOnly (browser) e `Authorization: Bearer` (cliente sem cookie).
 * No Swagger UI aparecem como dois cadeados — basta UM deles estar preenchido.
 */
export const ApiSessionAuth = () =>
  applyDecorators(ApiCookieAuth(SEC_SESSION_COOKIE), ApiBearerAuth(SEC_SESSION_BEARER));

/** Auth MÁQUINA-A-MÁQUINA (`@ServiceOnly`): header `X-Service-Key` = `SERVICE_API_KEY`. */
export const ApiServiceKeyAuth = () => applyDecorators(ApiSecurity(SEC_SERVICE_KEY));

/**
 * Schema inline do envelope de erro do `HttpExceptionFilter`:
 * `{ error, message, statusCode, details? }`. O cliente trata ESTE shape, nunca o
 * status cru.
 */
export function errorSchema(codes: string[], exampleMessage: string, statusCode: number): SchemaObject {
  return {
    type: 'object',
    required: ['error', 'message', 'statusCode'],
    properties: {
      error: { type: 'string', enum: codes, example: codes[0] },
      message: { type: 'string', example: exampleMessage },
      statusCode: { type: 'integer', example: statusCode },
      details: {
        description: 'Só em 400 de validação Zod: lista de `{ path, message }` por campo inválido.',
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', example: 'email' },
            message: { type: 'string', example: 'Invalid email' },
          },
        },
      },
    },
  };
}

/**
 * Empilha decorators de documentação NA ORDEM em que seriam escritos sobre o método.
 *
 * Serve para tirar a documentação de dentro do controller (para um `*.docs.ts` ao lado)
 * sem mudar o documento gerado: o `applyDecorators` do Nest aplica de cima para baixo,
 * e decorators empilhados no método aplicam de baixo para cima. A ordem decide a
 * sequência de `parameters` e `responses` no OpenAPI — por isso o `reverse()`.
 */
export const ApiDocs = (
  ...decorators: Array<ClassDecorator | MethodDecorator | PropertyDecorator>
) => applyDecorators(...[...decorators].reverse());

/** Envelope `{ data: [...] }` — o mesmo formato que a Admin-API da loja devolve. */
export const listOf = (properties: Record<string, SchemaObject>): SchemaObject => ({
  type: 'object',
  properties: { data: { type: 'array', items: { type: 'object', properties } } },
});

/** Envelope `{ data: { ... } }` de um objeto só. */
export const dataOf = (properties: Record<string, SchemaObject>): SchemaObject => ({
  type: 'object',
  properties: { data: { type: 'object', properties } },
});

/** 400 do `ZodValidationPipe` — sempre `invalid_input` + `details` por campo. */
export const ApiValidationErrorResponse = () =>
  ApiResponse({
    status: 400,
    description:
      'Payload reprovado pelo `ZodValidationPipe`. `details` traz um item por campo inválido (`path` + `message`).',
    schema: errorSchema(['invalid_input'], 'Payload inválido.', 400),
  });

/**
 * Headers de tenant do `TenantGuard` + os erros que ele produz.
 *
 * Ponha em TODA rota de dado (as que não têm `@SkipTenant()`). O guard é global, então
 * sem isto a rota funciona mas aparece no Swagger sem os headers — e quem for testar
 * pelo "Try it out" leva 400 sem entender por quê.
 *
 * `requiresStore` deve acompanhar o `@RequireStore()` da rota: muda o header de loja de
 * opcional para obrigatório na doc.
 */
export const ApiTenantHeaders = (requiresStore = false) =>
  applyDecorators(
    ApiHeader({
      name: 'X-Company-Id',
      required: true,
      description:
        'Empresa em nome da qual a requisição age. É ALVO, não credencial: o servidor confere o ' +
        'vínculo com o dono da sessão (`has_company_access`) e devolve **403** se não houver. ' +
        'Apontar para a empresa de outro não dá acesso — dá 403.',
      schema: { type: 'string', format: 'uuid', example: '00000000-0000-4000-8000-000000000000' },
    }),
    ApiHeader({
      name: 'X-Store-Id',
      required: requiresStore,
      description: requiresStore
        ? 'Loja alvo (obrigatória nesta rota). Precisa pertencer à empresa do `X-Company-Id` e o ' +
          'usuário precisa ser admin da empresa ou ter acesso explícito à loja.'
        : 'Loja alvo (opcional). Se vier, é validada como acima; se não vier, a rota age no ' +
          'escopo da empresa.',
      schema: { type: 'string', format: 'uuid', example: '00000000-0000-4000-8000-000000000001' },
    }),
    ApiResponse({
      status: 400,
      description:
        'Header de tenant ausente ou malformado (`company_required`, `invalid_company`, ' +
        '`store_required`, `invalid_store`) — ou payload reprovado pelo Zod (`invalid_input`).',
      schema: errorSchema(
        ['company_required', 'invalid_company', 'store_required', 'invalid_store', 'invalid_input'],
        'Header X-Company-Id ausente.',
        400,
      ),
    }),
    ApiResponse({
      status: 403,
      description:
        'Sem acesso à empresa ou à loja pedida. Mensagem propositalmente genérica: responder ' +
        'diferente para "não existe" e "não é membro" transformaria a rota num verificador de ' +
        'existência de empresa/loja.',
      schema: errorSchema(['forbidden'], 'Sem acesso a esta empresa.', 403),
    }),
  );

/**
 * 429 do `SessionThrottlerGuard` (roda ANTES da autenticação — request abusiva não deve
 * custar consulta). O default global é `RATE_LIMIT_LIMIT`/`RATE_LIMIT_TTL_SECONDS` (300 por
 * minuto) e conta por **SESSÃO**, não por IP: numa empresa todos saem pelo mesmo NAT, e
 * contar por IP faria o primeiro a abrir o dashboard derrubar os colegas.
 *
 * Quem não tem sessão (login, recovery) continua contando por IP — que é o que se quer
 * contra força bruta. Essas duas apertam para 10/min via `@Throttle`, e passam o texto certo
 * no parâmetro.
 */
export const ApiThrottleErrorResponse = (limitDescription = '300 requisições/minuto por sessão') =>
  ApiResponse({
    status: 429,
    description: `Rate-limit estourado (${limitDescription}). O guard de throttle roda antes da autenticação.`,
    schema: errorSchema(['error'], 'ThrottlerException: Too Many Requests', 429),
  });

/** 500 genérico — detalhe interno NUNCA vaza (só vai para o log). */
export const ApiInternalErrorResponse = () =>
  ApiResponse({
    status: 500,
    description: 'Erro interno. O detalhe real fica só no log do servidor — a resposta é genérica por segurança.',
    schema: errorSchema(['internal_error'], 'Erro interno.', 500),
  });

/**
 * Respostas de erro padrão das rotas que exigem SESSÃO de usuário. Aplique por rota;
 * acrescente o `@ApiResponse` de sucesso e os erros específicos (403, 404…) à parte.
 *
 * O 503 é o fail-closed do `SessionService`: um blip do banco vira 503, NUNCA 401 —
 * um erro de infraestrutura não pode deslogar a frota inteira.
 */
export const ApiSessionErrorResponses = () =>
  applyDecorators(ApiSessionUnauthorizedResponse(), ApiSessionInfraErrorResponses(), ApiInternalErrorResponse());

/**
 * Só o 401 da sessão. Separado do bloco acima para rotas que precisam declarar um 401
 * com códigos ADICIONAIS (ex.: usuário logado mas sem e-mail no Auth) — em OpenAPI há
 * uma resposta por status, então duplicar `@ApiResponse({ status: 401 })` na mesma rota
 * faz uma sobrescrever a outra.
 */
export const ApiSessionUnauthorizedResponse = (extraCodes: string[] = [], example = 'Sessão ausente. Faça login.') =>
  ApiResponse({
    status: 401,
    description: 'Sessão ausente, inválida ou expirada (cookie de sessão ou Bearer opaco).',
    schema: errorSchema(['unauthorized', ...extraCodes], example, 401),
  });

/**
 * Erros de infraestrutura comuns a toda rota autenticada por sessão: 429 (throttle) e
 * 503 (fail-closed do `SessionService` — um blip do banco vira 503, NUNCA 401, para um
 * erro de infra não deslogar a frota inteira).
 */
export const ApiSessionInfraErrorResponses = () =>
  applyDecorators(
    ApiThrottleErrorResponse(),
    ApiResponse({
      status: 503,
      description:
        'Fail-closed do `SessionService`: falha ao consultar o banco de sessões. É 503 (não 401) de propósito — o cliente deve tentar de novo, não deslogar.',
      schema: errorSchema(['service_unavailable'], 'Falha ao validar a sessão. Tente de novo.', 503),
    }),
  );

/** Respostas de erro padrão das rotas `@ServiceOnly` (máquina-a-máquina). */
export const ApiServiceKeyErrorResponses = () =>
  applyDecorators(
    ApiValidationErrorResponse(),
    ApiResponse({
      status: 401,
      description: '`X-Service-Key` ausente ou diferente de `SERVICE_API_KEY` (comparação timing-safe).',
      schema: errorSchema(['unauthorized'], 'X-Service-Key ausente ou inválida.', 401),
    }),
    ApiThrottleErrorResponse(),
    ApiInternalErrorResponse(),
  );
