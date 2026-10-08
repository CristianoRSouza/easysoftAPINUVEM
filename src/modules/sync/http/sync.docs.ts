import { ApiBody, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ApiDocs, ApiServiceKeyErrorResponses } from '../../../common/swagger';

/**
 * Documentação OpenAPI da fila de sync (máquina-a-máquina). Cada `Doc*` equivale a
 * empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

const UUID = { type: 'string' as const, format: 'uuid' };

export const DocOutboxPending = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Eventos da outbox ainda não despachados (pull do worker)',
      description:
        'Ordenados por `changed_at, event_id` — a MESMA ordem do `PgRemoteSupabaseSyncAdapter` que ' +
        'isto substituiu, porque a fila é aplicada na ordem em que sai.\n\n' +
        '`companyId`/`storeId` são **opcionais e andam em par**: informar só um é o mesmo que não ' +
        'informar nenhum, e a varredura passa a ser global. Quando vêm os dois, o filtro aceita ' +
        'também o NIL UUID (`00000000-...-000000000000`), que é como a fila marca evento de ' +
        '**broadcast** — sem esse termo a loja deixaria de receber o que é destinado a todas.\n\n' +
        '`limit=0` é válido e devolve lista vazia: é o *connectivity check* do worker, que assim ' +
        'confirma chave e rota sem arrastar mil linhas.',
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      schema: { type: 'integer', minimum: 0, maximum: 5000, default: 1000 },
    }),
    ApiQuery({ name: 'companyId', required: false, schema: UUID }),
    ApiQuery({ name: 'storeId', required: false, schema: UUID }),
    ApiResponse({
      status: 200,
      description: 'Eventos pendentes, do mais antigo para o mais novo.',
      schema: {
        type: 'object',
        properties: {
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                event_id: UUID,
                entity_name: { type: 'string', example: 'products' },
                entity_id: UUID,
                op: { type: 'string', example: 'upsert' },
                payload: { type: 'object', additionalProperties: true },
                company_id: UUID,
                store_id: UUID,
              },
            },
          },
        },
      },
    }),
    ApiServiceKeyErrorResponses(),
  );

export const DocInbox = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Entrega um lote de eventos na inbox (push do worker)',
      description:
        '**Idempotente por `event_id`** (`ON CONFLICT DO NOTHING`): reenviar o mesmo lote é seguro e ' +
        'não duplica nada — é o que permite ao worker repetir a entrega depois de uma queda de rede ' +
        'sem saber se a primeira chegou.\n\n' +
        'Por isso `received` conta o que foi **enviado**, não o que foi gravado: um lote inteiro já ' +
        'conhecido também responde `received` igual ao tamanho do lote. Quem quiser saber o que de ' +
        'fato entrou deve olhar a inbox, não este número.\n\n' +
        'O lote vira UMA statement (`jsonb_to_recordset`), então ou entra inteiro ou não entra nada. ' +
        'Teto de 5000 linhas por chamada.',
    }),
    ApiBody({
      schema: {
        type: 'object',
        required: ['origin', 'rows'],
        properties: {
          origin: { type: 'string', enum: ['local', 'supabase'] },
          rows: {
            type: 'array',
            maxItems: 5000,
            items: {
              type: 'object',
              required: ['event_id', 'entity_name', 'entity_id', 'op', 'company_id', 'store_id'],
              properties: {
                event_id: UUID,
                entity_name: { type: 'string', example: 'products' },
                entity_id: UUID,
                op: { type: 'string', example: 'upsert' },
                payload: { type: 'object', additionalProperties: true },
                company_id: UUID,
                store_id: UUID,
              },
            },
          },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Lote aceito. `received` = tamanho do lote enviado (ver nota sobre idempotência).',
      schema: { type: 'object', properties: { received: { type: 'integer', example: 120 } } },
    }),
    ApiServiceKeyErrorResponses(),
  );

export const DocOutboxDispatched = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Confirma o despacho dos eventos (ack do worker)',
      description:
        'Marca `dispatched` só o que ainda estava `pending`. O `WHERE` carrega essa condição de ' +
        'propósito: um ack repetido não reescreve `dispatched_at`, então o carimbo continua sendo o ' +
        'da entrega de verdade.\n\n' +
        'Daí `updated` poder vir **menor** que o número de ids enviados — isso é ack repetido, não ' +
        'erro, e o worker não deve tratar como falha. Teto de 5000 ids por chamada.',
    }),
    ApiBody({
      schema: {
        type: 'object',
        required: ['eventIds'],
        properties: { eventIds: { type: 'array', maxItems: 5000, items: UUID } },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Quantos eventos saíram de `pending` nesta chamada.',
      schema: { type: 'object', properties: { updated: { type: 'integer', example: 120 } } },
    }),
    ApiServiceKeyErrorResponses(),
  );
