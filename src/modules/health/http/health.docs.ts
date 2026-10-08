import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiDocs, ApiServiceKeyAuth, ApiServiceKeyErrorResponses } from '../../../common/swagger';

/**
 * Documentação OpenAPI das rotas de health. Cada `Doc*` equivale a empilhar os mesmos
 * decorators sobre o método, na mesma ordem.
 */

const okSchema: SchemaObject = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['ok'], example: 'ok' } },
};

const buildSchema: SchemaObject = {
  type: 'object',
  properties: { build: { type: 'string', example: 't-ca24c93d98f8dc29e8895f9cbff56888e721aa0a' } },
};

export const DocLive = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Liveness do processo (usado pelo orquestrador/Docker)',
      description:
        'Responde 200 sempre que o processo aceita requisições. **Não** toca o Postgres nem o Supabase de ' +
        'propósito: um blip do banco não pode fazer o orquestrador matar/derrubar o container. Pública ' +
        '(`@Public`) — sem sessão nem chave.',
    }),
    ApiResponse({ status: 200, description: 'Processo no ar.', schema: okSchema }),
  );

export const DocHealth = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Health público mínimo (idêntico ao liveness)',
      description:
        'Mesmo corpo do `/health/live`. É deliberadamente mínimo: **nenhuma** métrica interna (contadores, ' +
        'versão, estado de dependências) vaza numa rota pública. Pública (`@Public`).',
    }),
    ApiResponse({ status: 200, description: 'Processo no ar.', schema: okSchema }),
  );

export const DocBuild = () =>
  ApiDocs(
    ApiServiceKeyAuth(),
    ApiOperation({
      summary: 'Identidade da imagem em execução (máquina-a-máquina)',
      description:
        'Devolve o `BUILD_ID` gravado na imagem. Na esteira `hom → main` é `t-<árvore do código>`, e a ' +
        'produção promove a imagem da homologação sem recompilar, então os dois ambientes têm que ' +
        'responder o **mesmo** valor. Exige `X-Service-Key`: versão não vaza em rota pública.',
    }),
    ApiResponse({ status: 200, description: 'Identidade da imagem.', schema: buildSchema }),
    ApiServiceKeyErrorResponses(),
  );
