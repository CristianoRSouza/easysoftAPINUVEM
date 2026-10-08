import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CompanyId, OptionalStoreId } from '../../../common/http/request.decorators';
import { ApiSessionAuth } from '../../../common/swagger';
import { SyncPanelService } from '../application/sync-panel.service';
import {
  DocInboxActiveRetries,
  DocInboxApplyRate,
  DocInboxBacklog,
  DocInboxByEntity,
  DocInboxFailuresByError,
  DocInboxRecentAll,
  DocInboxRecentApplied,
  DocInboxRecentFailures,
  DocInboxSummary,
  DocOutboxActiveRetries,
  DocOutboxBacklog,
  DocOutboxByEntity,
  DocOutboxDispatchRate,
  DocOutboxFailuresByError,
  DocOutboxRecentAll,
  DocOutboxRecentFailures,
  DocOutboxSummary,
} from './sync-panel.docs';

/**
 * Painel de sincronização — o que a nuvem recebeu da loja (`inbox`) e o que tem para
 * mandar (`outbox`).
 *
 * As 17 rotas são declaradas no catálogo e atendidas por um caso de uso só
 * (`SyncPanelService.run`). O Nest não registra rota por laço, então cada path é
 * declarado com `@Get` explícito abaixo — mas todos pedem a rota ao service pelo path.
 * Os paths são os MESMOS que a Admin-API da loja serve: um contrato, duas implementações.
 *
 * `limit`/`offset` seguem crus (texto) até o service: a conversão mora num lugar só,
 * `sync-panel-paging.rule.ts`.
 */
@ApiTags('Painel de sync')
@ApiSessionAuth()
@Controller('sync')
export class SyncPanelController {
  constructor(private readonly service: SyncPanelService) {}

  // ── Inbox ──────────────────────────────────────────────────────────────────
  @Get('inbox/summary')
  @DocInboxSummary()
  async inboxSummary(@CompanyId() companyId: string, @OptionalStoreId() storeId: string | null) {
    return { data: await this.service.run('inbox/summary', companyId, storeId) };
  }

  @Get('inbox/by-entity')
  @DocInboxByEntity()
  async inboxByEntity(@CompanyId() companyId: string, @OptionalStoreId() storeId: string | null) {
    return { data: await this.service.run('inbox/by-entity', companyId, storeId) };
  }

  @Get('inbox/failures-by-error')
  @DocInboxFailuresByError()
  async inboxFailuresByError(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
  ) {
    return { data: await this.service.run('inbox/failures-by-error', companyId, storeId) };
  }

  @Get('inbox/backlog')
  @DocInboxBacklog()
  async inboxBacklog(@CompanyId() companyId: string, @OptionalStoreId() storeId: string | null) {
    return { data: await this.service.run('inbox/backlog', companyId, storeId) };
  }

  @Get('inbox/apply-rate')
  @DocInboxApplyRate()
  async inboxApplyRate(@CompanyId() companyId: string, @OptionalStoreId() storeId: string | null) {
    return { data: await this.service.run('inbox/apply-rate', companyId, storeId) };
  }

  @Get('inbox/active-retries')
  @DocInboxActiveRetries()
  async inboxActiveRetries(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
    @Query('limit') limit?: string,
  ) {
    return { data: await this.service.run('inbox/active-retries', companyId, storeId, { limit }) };
  }

  @Get('inbox/recent-failures')
  @DocInboxRecentFailures()
  async inboxRecentFailures(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
    @Query('limit') limit?: string,
  ) {
    return { data: await this.service.run('inbox/recent-failures', companyId, storeId, { limit }) };
  }

  @Get('inbox/recent-applied')
  @DocInboxRecentApplied()
  async inboxRecentApplied(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
    @Query('limit') limit?: string,
  ) {
    return { data: await this.service.run('inbox/recent-applied', companyId, storeId, { limit }) };
  }

  @Get('inbox/recent-all')
  @DocInboxRecentAll()
  async inboxRecentAll(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return {
      data: await this.service.run('inbox/recent-all', companyId, storeId, { limit, offset }),
    };
  }

  // ── Outbox ─────────────────────────────────────────────────────────────────
  @Get('outbox/summary')
  @DocOutboxSummary()
  async outboxSummary(@CompanyId() companyId: string, @OptionalStoreId() storeId: string | null) {
    return { data: await this.service.run('outbox/summary', companyId, storeId) };
  }

  @Get('outbox/by-entity')
  @DocOutboxByEntity()
  async outboxByEntity(@CompanyId() companyId: string, @OptionalStoreId() storeId: string | null) {
    return { data: await this.service.run('outbox/by-entity', companyId, storeId) };
  }

  @Get('outbox/failures-by-error')
  @DocOutboxFailuresByError()
  async outboxFailuresByError(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
  ) {
    return { data: await this.service.run('outbox/failures-by-error', companyId, storeId) };
  }

  @Get('outbox/backlog')
  @DocOutboxBacklog()
  async outboxBacklog(@CompanyId() companyId: string, @OptionalStoreId() storeId: string | null) {
    return { data: await this.service.run('outbox/backlog', companyId, storeId) };
  }

  @Get('outbox/dispatch-rate')
  @DocOutboxDispatchRate()
  async outboxDispatchRate(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
  ) {
    return { data: await this.service.run('outbox/dispatch-rate', companyId, storeId) };
  }

  @Get('outbox/active-retries')
  @DocOutboxActiveRetries()
  async outboxActiveRetries(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
    @Query('limit') limit?: string,
  ) {
    return { data: await this.service.run('outbox/active-retries', companyId, storeId, { limit }) };
  }

  @Get('outbox/recent-failures')
  @DocOutboxRecentFailures()
  async outboxRecentFailures(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
    @Query('limit') limit?: string,
  ) {
    return { data: await this.service.run('outbox/recent-failures', companyId, storeId, { limit }) };
  }

  @Get('outbox/recent-all')
  @DocOutboxRecentAll()
  async outboxRecentAll(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return {
      data: await this.service.run('outbox/recent-all', companyId, storeId, { limit, offset }),
    };
  }
}
