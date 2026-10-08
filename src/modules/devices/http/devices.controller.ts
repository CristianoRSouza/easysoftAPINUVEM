import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireStore } from '../../../common/decorators';
import { CompanyId, OptionalStoreId, StoreId } from '../../../common/http/request.decorators';
import { ApiSessionAuth } from '../../../common/swagger';
import { UUID_RE } from '../../../common/validation/uuid';
import { DevicesService } from '../application/devices.service';
import { validId } from './device-id';
import {
  DocAgentAudit,
  DocAgents,
  DocAvailableLicenses,
  DocPixnopdvCredentials,
  DocProductImages,
  DocTotemAudit,
  DocTotemLicenses,
  DocTotems,
  DocUnifiedAudit,
} from './devices.docs';

/**
 * Agentes de NFC-e e auditoria de dispositivos — rotas de LEITURA.
 *
 * ⚠️ Correção de segurança, igual à das filhas da NFC-e: no browser,
 * `fetchCloudAgentAuditLogs` filtra **só por `agent_config_id`**, sem empresa — quem
 * barrava agente alheio era a RLS. O role desta API tem `BYPASSRLS`, então cada rota
 * filha confere o vínculo explicitamente. Sem isso, um id alheio leria o histórico de
 * configuração fiscal de outra empresa, incluindo os valores antigos e novos de cada
 * campo alterado.
 *
 * As rotas de **escrita** (criar/editar/ativar agente e totem) ficam de fora desta onda
 * de propósito: são as primeiras que alteram dados, e o ambiente é produção única.
 */
@ApiTags('Dispositivos')
@ApiSessionAuth()
@Controller()
export class DevicesController {
  constructor(private readonly service: DevicesService) {}

  @Get('totems')
  @DocTotems()
  async totems(@CompanyId() companyId: string, @OptionalStoreId() storeId: string | null) {
    return { data: await this.service.totems(companyId, storeId) };
  }

  @Get('totem-licenses')
  @DocTotemLicenses()
  async totemLicenses(@CompanyId() companyId: string, @OptionalStoreId() storeId: string | null) {
    return { data: await this.service.totemLicenses(companyId, storeId) };
  }

  @Get('totem-available-licenses')
  @DocAvailableLicenses()
  async availableLicenses(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
    @Query('totemId') totemId?: string,
  ) {
    const id = String(totemId ?? '').trim();
    // Query string vazia vira `undefined`, não string vazia: `''::uuid` estoura no Postgres.
    if (id && !UUID_RE.test(id)) {
      throw new BadRequestException({
        error: 'invalid_totem_id',
        message: 'totemId deve ser um UUID.',
      });
    }
    return {
      data: await this.service.availableTotemLicenses(companyId, storeId, id || null),
    };
  }

  @Get('pixnopdv-store-credentials')
  @RequireStore()
  @DocPixnopdvCredentials()
  async pixnopdv(@CompanyId() companyId: string, @StoreId() storeId: string) {
    return { data: await this.service.pixnopdvCredentials(companyId, storeId) };
  }

  @Get('product-images')
  @RequireStore()
  @DocProductImages()
  async productImages(@StoreId() storeId: string, @Query('ids') ids?: string) {
    const lista = String(ids ?? '').split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s));
    if (lista.length > 200) {
      throw new BadRequestException({ error: 'too_many_ids', message: 'No máximo 200 ids por chamada.' });
    }
    return { data: await this.service.productImages(storeId, lista) };
  }

  @Get('service-agents')
  @DocAgents()
  async agents(@CompanyId() companyId: string, @OptionalStoreId() storeId: string | null) {
    return { data: await this.service.agents(companyId, storeId) };
  }

  @Get('service-agents/:agentId/audit-logs')
  @DocAgentAudit()
  async agentAudit(@CompanyId() companyId: string, @Param('agentId') agentId: string) {
    return { data: await this.service.agentAuditLogs(companyId, validId(agentId, 'agent')) };
  }

  @Get('totems/:totemId/audit-logs')
  @DocTotemAudit()
  async totemAudit(@CompanyId() companyId: string, @Param('totemId') totemId: string) {
    return { data: await this.service.totemAuditLogs(companyId, validId(totemId, 'totem')) };
  }

  @Get('audit-logs')
  @DocUnifiedAudit()
  async unifiedAudit(@CompanyId() companyId: string, @Query('limit') limit?: string) {
    const n = parseInt(String(limit ?? '100'), 10);
    return { data: await this.service.unifiedAuditLogs(companyId, Number.isFinite(n) ? n : 100) };
  }
}
