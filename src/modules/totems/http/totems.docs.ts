import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  ApiDocs,
  ApiSessionInfraErrorResponses,
  ApiSessionUnauthorizedResponse,
  ApiValidationErrorResponse,
  errorSchema,
} from '../../../common/swagger';

/**
 * Documentação OpenAPI da cifra de segredos TEF — fora do controller.
 * `DocEncryptTefSecrets` equivale a empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

export const DocEncryptTefSecrets = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Cifra os segredos TEF (Aditum) do totem no envelope `enc:v1`',
      description:
        'Migra `encrypt-totem-tef-secrets`. Recebe os segredos em claro e devolve o texto cifrado no envelope ' +
        '`enc:v1:<iv_b64>:<tag_b64>:<data_b64>` (AES-256-GCM, IV de 12 bytes) — **mesmo formato** que o Electron/' +
        'totem sabe decifrar. Só a resposta é cifrada: **esta rota não grava nada** no banco.\n\n' +
        '**Autorização:** sessão válida **e** ser admin da empresa dona da loja (RPC ' +
        '`public.is_company_admin_for_store`). A cifra usa a master key COMPARTILHADA, então não pode virar um ' +
        'oráculo aberto a qualquer usuário logado — daí a checagem por loja, e não só "estar logado".\n\n' +
        'Campos vazios/nulos/só-espaços são ignorados: o par `*_encrypted`/`*_kid` correspondente volta `null`. ' +
        'Sem `SENSITIVE_SECRET_MASTER_KEY_BASE64` (ou com chave que não tenha 32 bytes) a rota devolve 500 — ' +
        'fail-closed, nunca cifra com chave fraca.',
    }),
    ApiBody({
      required: true,
      schema: {
        type: 'object',
        required: ['store_id'],
        properties: {
          store_id: {
            type: 'string',
            format: 'uuid',
            description: 'Loja dona do totem. O chamador precisa ser admin dela.',
            example: '00000000-0000-4000-8000-000000000000',
          },
          partner_token: {
            type: 'string',
            nullable: true,
            maxLength: 4096,
            description: 'Segredo em claro (sem null bytes). Ausente/vazio → resultado `null`.',
            example: '<partner-token-em-claro>',
          },
          ativation_code: {
            type: 'string',
            nullable: true,
            maxLength: 4096,
            description: 'Segredo em claro (sem null bytes). Ausente/vazio → resultado `null`. Grafia as-is do contrato.',
            example: '<codigo-de-ativacao-em-claro>',
          },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Segredos cifrados. `kid` identifica a chave usada — grave junto para permitir rotação futura.',
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          kid: { type: 'string', example: 'kid-sensitive-local-aes-sync' },
          partner_token_encrypted: { type: 'string', nullable: true, example: 'enc:v1:<iv>:<tag>:<data>' },
          partner_token_kid: { type: 'string', nullable: true, example: 'kid-sensitive-local-aes-sync' },
          ativation_code_encrypted: { type: 'string', nullable: true, example: 'enc:v1:<iv>:<tag>:<data>' },
          ativation_code_kid: { type: 'string', nullable: true, example: 'kid-sensitive-local-aes-sync' },
        },
      },
    }),
    ApiValidationErrorResponse(),
    ApiResponse({
      status: 403,
      description: 'Sessão válida, mas o usuário não é admin da empresa dona desta loja.',
      schema: errorSchema(['forbidden'], 'Sem permissão para esta loja.', 403),
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
