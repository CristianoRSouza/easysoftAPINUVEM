import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireStore } from '../../../common/decorators';
import { CompanyId, IsCompanyAdmin, StoreId } from '../../../common/http/request.decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiSessionAuth } from '../../../common/swagger';
import {
  nfceListQuerySchema,
  nfceTotalsQuerySchema,
  type NfceListQuery,
  type NfceTotalsQuery,
} from '../../../contract/nfce.schema';
import { NfceService } from '../application/nfce.service';
import {
  DocAcbrConfig,
  DocAttentionCounts,
  DocDetail,
  DocEvents,
  DocIssuerConfig,
  DocItems,
  DocLogs,
  DocNotes,
  DocPayments,
  DocTotals,
} from './nfce.docs';
import { validNote } from './note-id.param';

/**
 * NFC-e (leitura). Tudo é de UMA loja.
 *
 * ⚠️ O ganho de segurança desta migração está aqui: no browser, as consultas de
 * pagamentos/logs/eventos filtram **só por `note_id`** e quem barrava nota de outra loja
 * era a RLS do Supabase. O role desta API tem `BYPASSRLS`, então cada rota filha confere
 * o vínculo nota↔loja explicitamente. Sem isso, um `note_id` alheio leria o documento
 * fiscal de outra empresa.
 *
 * As rotas de XML (`xml-archive` e `notes/:noteId/xml/:kind`) estão em `NfceXmlController`.
 */
@ApiTags('NFC-e')
@ApiSessionAuth()
@Controller('nfce')
export class NfceController {
  constructor(private readonly service: NfceService) {}

  @Get('attention-counts')
  @RequireStore()
  @DocAttentionCounts()
  async attentionCounts(@StoreId() storeId: string) {
    return { data: await this.service.attentionCounts(storeId) };
  }

  @Get('notes')
  @RequireStore()
  @DocNotes()
  list(
    @StoreId() storeId: string,
    @Query(new ZodValidationPipe(nfceListQuerySchema)) query: NfceListQuery,
  ) {
    return this.service.list(storeId, query);
  }

  @Get('totals')
  @RequireStore()
  @DocTotals()
  async totals(
    @StoreId() storeId: string,
    @Query(new ZodValidationPipe(nfceTotalsQuerySchema)) query: NfceTotalsQuery,
  ) {
    return { data: await this.service.totals(storeId, query) };
  }

  @Get('notes/:noteId')
  @RequireStore()
  @DocDetail()
  async detail(@StoreId() storeId: string, @Param('noteId') noteId: string) {
    return { data: await this.service.detail(storeId, validNote(noteId)) };
  }

  @Get('issuer-config')
  @RequireStore()
  @DocIssuerConfig()
  async issuerConfig(
    @CompanyId() companyId: string,
    @StoreId() storeId: string,
    // `isCompanyAdmin` vem do TenantGuard, que resolveu o papel contra o banco.
    @IsCompanyAdmin() ehAdmin: boolean,
  ) {
    const data = await this.service.issuerConfig(companyId, storeId, ehAdmin);
    return { data };
  }

  @Get('acbr-config')
  @RequireStore()
  @DocAcbrConfig()
  async acbrConfig(@CompanyId() companyId: string, @StoreId() storeId: string) {
    return { data: await this.service.acbrConfig(companyId, storeId) };
  }

  @Get('notes/:noteId/items')
  @RequireStore()
  @DocItems()
  async items(@StoreId() storeId: string, @Param('noteId') noteId: string) {
    return { data: await this.service.items(storeId, validNote(noteId)) };
  }

  @Get('notes/:noteId/payments')
  @RequireStore()
  @DocPayments()
  async payments(@StoreId() storeId: string, @Param('noteId') noteId: string) {
    return { data: await this.service.payments(storeId, validNote(noteId)) };
  }

  @Get('notes/:noteId/logs')
  @RequireStore()
  @DocLogs()
  async logs(@StoreId() storeId: string, @Param('noteId') noteId: string) {
    return { data: await this.service.logs(storeId, validNote(noteId)) };
  }

  @Get('notes/:noteId/events')
  @RequireStore()
  @DocEvents()
  async events(@StoreId() storeId: string, @Param('noteId') noteId: string) {
    return { data: await this.service.events(storeId, validNote(noteId)) };
  }
}
