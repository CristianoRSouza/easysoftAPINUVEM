import { ApiBody, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import {
  ApiDocs,
  ApiSessionInfraErrorResponses,
  ApiSessionUnauthorizedResponse,
  errorSchema,
} from '../../../common/swagger';

/**
 * Documentação OpenAPI do código de primeiro acesso — fora do controller.
 * `DocBootstrapCode` equivale a empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

export const DocBootstrapCode = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Emite o código de primeiro acesso (bootstrap) da loja, verificável offline',
      description:
        'Migra `issue-bootstrap-code`. Gera um código assinado que a **Admin-API local** da loja verifica ' +
        '**offline** (sem chamar a nuvem) — é assim que uma instalação nova se auto-configura mesmo com internet ' +
        'instável.\n\n' +
        '**Formato imutável** (contrato byte-a-byte com a Admin-API local): ' +
        '`EFB1.<b64url(json)>.<b64url(hmacSha256)>`, com payload `{ v:1, em, sid, exp, jti }` e chave derivada por ' +
        '`HKDF-SHA256(ikm=master, salt=vazio, info="easyfood/bootstrap-code/v1", 32B)`.\n\n' +
        '**Autorização:** sessão válida **e** ser admin da empresa dona da loja (RPC ' +
        '`public.is_company_admin_for_store`). Nada é gravado no banco: o código é auto-contido e expira sozinho.\n\n' +
        '**TTL:** `ttl_hours` default **48h**, teto **72h** (valor maior é silenciosamente reduzido ao teto; ' +
        'ausente, zero ou não-numérico cai no default).',
    }),
    ApiParam({
      name: 'storeId',
      required: true,
      type: String,
      format: 'uuid',
      description: 'UUID da loja (`pv_stores.id`). Validado por regex no service — formato inválido → 400 `invalid_store`.',
      example: '00000000-0000-4000-8000-000000000000',
    }),
    ApiBody({
      required: true,
      schema: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'E-mail que ficará amarrado ao código (normalizado para minúsculas). Validado por regex.',
            example: 'operador@exemplo.com.br',
          },
          ttl_hours: {
            type: 'number',
            description: 'Validade em horas. Default 48; máximo 72 (acima disso é reduzido ao teto).',
            default: 48,
            maximum: 72,
            example: 48,
          },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Código emitido. Ele é auto-contido — não existe cópia no servidor para recuperar depois.',
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          code: { type: 'string', example: 'EFB1.<payload-b64url>.<hmac-b64url>' },
          email: { type: 'string', format: 'email', example: 'operador@exemplo.com.br' },
          store_id: { type: 'string', format: 'uuid' },
          expires_at: { type: 'string', format: 'date-time', example: '2026-08-01T12:00:00.000Z' },
        },
      },
    }),
    ApiResponse({
      status: 400,
      description:
        'E-mail fora do formato (`invalid_email`), `storeId` que não é UUID (`invalid_store`) ou payload reprovado ' +
        'pelo Zod (`invalid_input`, com `details` por campo).',
      schema: errorSchema(['invalid_email', 'invalid_store', 'invalid_input'], 'Email inválido.', 400),
    }),
    ApiResponse({
      status: 403,
      description: 'Sessão válida, mas o usuário não é admin da empresa dona desta loja.',
      schema: errorSchema(['forbidden'], 'Sem permissão para gerar código nesta loja.', 403),
    }),
    ApiSessionUnauthorizedResponse(),
    ApiSessionInfraErrorResponses(),
    ApiResponse({
      status: 500,
      description:
        '`SENSITIVE_SECRET_MASTER_KEY_BASE64` ausente (`not_configured`) ou com tamanho diferente de 32 bytes ' +
        '(`bad_key`) — fail-closed. Ou erro interno não tratado.',
      schema: errorSchema(
        ['not_configured', 'bad_key', 'internal_error'],
        'SENSITIVE_SECRET_MASTER_KEY_BASE64 ausente.',
        500,
      ),
    }),
  );
