import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  ApiDocs,
  ApiSessionErrorResponses,
  ApiValidationErrorResponse,
} from '../../../common/swagger';

/**
 * Documentação OpenAPI da telemetria — fora do controller. `DocErrorReport` equivale a
 * empilhar os mesmos decorators sobre o método, na mesma ordem.
 */
export const DocErrorReport = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Encaminha um relatório de erro ao EasyGuardian (proxy que injeta o secret)',
      description:
        'Migra `error-report-proxy`. A API repassa o corpo **como veio** ao EasyGuardian, acrescentando o header ' +
        '`x-report-secret` **server-side** — o segredo nunca chega ao browser. Exige sessão para bloquear spam ' +
        'anônimo (mesma regra da edge function).\n\n' +
        '**O corpo é opaco:** aceita qualquer objeto JSON (o schema do relatório é do EasyGuardian, não desta ' +
        'API). Só duas travas na borda: precisa ser um **objeto** (array/string/número → 400) e no máximo ' +
        '**64 KB** serializado — a API não vira relay de payload arbitrário.\n\n' +
        '**Status e corpo são os do upstream** (repassados na íntegra); se a resposta dele não for JSON válido, ' +
        'volta `{ raw: "<texto>" }`. Upstream inalcançável → **502** `upstream_unreachable`.',
    }),
    ApiBody({
      required: true,
      description: 'Objeto JSON livre (o contrato é do EasyGuardian). Máximo 64 KB serializado.',
      schema: {
        type: 'object',
        additionalProperties: true,
        example: {
          app: 'manager-web',
          message: 'TypeError: cannot read property of undefined',
          stack: '<stack trace>',
          context: { route: '/pedidos', build: '1.4.2' },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description:
        'Resposta do EasyGuardian, repassada na íntegra (status **e** corpo). Não-JSON vira `{ raw: "<texto>" }`.',
      schema: { type: 'object', additionalProperties: true },
    }),
    ApiValidationErrorResponse(),
    ApiResponse({
      status: 502,
      description: 'Falha de rede ao falar com o EasyGuardian (o upstream não respondeu).',
      schema: {
        type: 'object',
        properties: {
          error: { type: 'string', enum: ['upstream_unreachable'], example: 'upstream_unreachable' },
          message: { type: 'string', example: 'Falha ao encaminhar o relatório.' },
        },
      },
    }),
    ApiResponse({
      status: 503,
      description:
        '`ERROR_REPORT_SECRET` ausente no ambiente (fail-closed). Sem ele o EasyGuardian rejeitaria o ' +
        'relatório com 401 e o erro se perderia em silêncio — a API prefere falhar visível e logar.',
      schema: {
        type: 'object',
        properties: {
          error: { type: 'string', enum: ['telemetry_not_configured'], example: 'telemetry_not_configured' },
          message: { type: 'string', example: 'ERROR_REPORT_SECRET ausente.' },
        },
      },
    }),
    ApiSessionErrorResponses(),
  );
