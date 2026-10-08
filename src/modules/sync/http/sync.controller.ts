import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ServiceOnly } from '../../../common/decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiServiceKeyAuth } from '../../../common/swagger';
import { SyncService } from '../application/sync.service';
import {
  inboxInsertSchema,
  outboxDispatchedSchema,
  outboxPendingQuerySchema,
  type InboxInsertInput,
  type OutboxDispatchedInput,
  type OutboxPendingQuery,
} from '../dto/sync.schema';
import { DocInbox, DocOutboxDispatched, DocOutboxPending } from './sync.docs';

/**
 * Fila de sync (ecb_sync) para o Sync-PG-SB — máquina-a-máquina (@ServiceOnly, X-Service-Key),
 * substitui o acesso pg direto/PostgREST do worker das lojas. Camada 1b do cutover.
 *
 * ⚠️ `@Controller('sync')` aqui e no SyncPanelController são o MESMO prefixo, de propósito:
 * o worker e o Monitor de Sincronização falam da mesma fila. O que separa os dois é o
 * sufixo do path (`outbox/pending` × `outbox/summary`) e a AUTH — aqui é chave de serviço,
 * lá é sessão de usuário. Ao acrescentar rota em qualquer um dos dois, confira que o path
 * novo não existe no outro: o Nest registra o primeiro que encontrar e o segundo vira rota
 * morta, sem erro nenhum no boot.
 */
@ApiTags('Fila de sync (máquina-a-máquina)')
@ApiServiceKeyAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly service: SyncService) {}

  /** Pull: outbox pending (filtro tenant opcional). limit=0 serve de connectivity check. */
  @ServiceOnly()
  @Get('outbox/pending')
  @DocOutboxPending()
  async pending(@Query(new ZodValidationPipe(outboxPendingQuerySchema)) query: OutboxPendingQuery) {
    const rows = await this.service.fetchPendingOutbox(query.limit, query.companyId, query.storeId);
    return { rows };
  }

  /** Push: insere lote na inbox, idempotente por event_id. */
  @ServiceOnly()
  @Post('inbox')
  @HttpCode(200)
  @DocInbox()
  inbox(@Body(new ZodValidationPipe(inboxInsertSchema)) body: InboxInsertInput) {
    return this.service.insertInboxIgnoreDuplicates(body.origin, body.rows);
  }

  /** Ack: marca dispatched os event_id ainda pending; devolve quantos. */
  @ServiceOnly()
  @Post('outbox/dispatched')
  @HttpCode(200)
  @DocOutboxDispatched()
  dispatched(@Body(new ZodValidationPipe(outboxDispatchedSchema)) body: OutboxDispatchedInput) {
    return this.service.markOutboxDispatched(body.eventIds);
  }
}
