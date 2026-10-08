import { Body, Controller, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireStore } from '../../../common/decorators';
import {
  CompanyId,
  OptionalStoreId,
  StoreId,
  UserId,
} from '../../../common/http/request.decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiSessionAuth } from '../../../common/swagger';
import {
  agentCreateSchema,
  agentUpdateSchema,
  type AgentCreateInput,
  type AgentUpdateInput,
} from '../../../contract/agent-write.schema';
import {
  agentActiveSchema,
  pixnopdvPutSchema,
  totemActiveSchema,
  type AgentActiveInput,
  type PixnopdvPutInput,
  type TotemActiveInput,
} from '../../../contract/devices-write.schema';
import {
  totemCreateSchema,
  totemUpdateSchema,
  type TotemCreateInput,
  type TotemUpdateInput,
} from '../../../contract/totem-write.schema';
import { AgentWriteService } from '../application/agent-write.service';
import { PixnopdvWriteService } from '../application/pixnopdv-write.service';
import { TotemActivationService } from '../application/totem-activation.service';
import { TotemWriteService } from '../application/totem-write.service';
import { validId } from './device-id';
import {
  DocCreateAgent,
  DocCreateTotem,
  DocRequeueTotemSync,
  DocSavePixnopdv,
  DocSetAgentActive,
  DocSetTotemActive,
  DocUpdateAgent,
  DocUpdateTotem,
} from './devices-write.docs';

/**
 * Escritas de dispositivos.
 *
 * ⚠️ É aqui que a varredura do `cloud-data.ts` mais importou. Lá, sete escritas fazem
 * `.update({...}).eq("id", id)` e mais nada — seguro no navegador porque a RLS barra a
 * linha alheia, **inseguro aqui** porque o role da API tem `BYPASSRLS`. Sem a amarra,
 * qualquer usuário logado desativaria o agente de NFC-e de outra empresa, parando a
 * emissão de nota na loja dela.
 */
@ApiTags('Dispositivos (escrita)')
@ApiSessionAuth()
@Controller()
export class DevicesWriteController {
  constructor(
    private readonly totemActivation: TotemActivationService,
    private readonly totems: TotemWriteService,
    private readonly agents: AgentWriteService,
    private readonly pixnopdv: PixnopdvWriteService,
  ) {}

  @Patch('totems/:totemId/active')
  @DocSetTotemActive()
  setTotemActive(
    @CompanyId() companyId: string,
    @UserId() userId: string,
    @Param('totemId') totemId: string,
    @Body(new ZodValidationPipe(totemActiveSchema)) body: TotemActiveInput,
  ) {
    return this.totemActivation.setTotemActive(companyId, validId(totemId, 'totem'), body, userId);
  }

  @Post('totems')
  @DocCreateTotem()
  createTotem(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
    @UserId() userId: string,
    @Body(new ZodValidationPipe(totemCreateSchema)) body: TotemCreateInput,
  ) {
    return this.totems.createTotem(companyId, storeId, body, userId);
  }

  @Patch('totems/:totemId')
  @DocUpdateTotem()
  updateTotem(
    @CompanyId() companyId: string,
    @UserId() userId: string,
    @Param('totemId') totemId: string,
    @Body(new ZodValidationPipe(totemUpdateSchema)) body: TotemUpdateInput,
  ) {
    return this.totems.updateTotem(companyId, validId(totemId, 'totem'), body, userId);
  }

  @Post('totems/:totemId/requeue-cloud-sync')
  @DocRequeueTotemSync()
  requeue(
    @CompanyId() companyId: string,
    @UserId() userId: string,
    @Param('totemId') totemId: string,
  ) {
    return this.totemActivation.requeueTotemSync(companyId, validId(totemId, 'totem'), userId);
  }

  @Post('service-agents')
  @DocCreateAgent()
  createAgent(
    @CompanyId() companyId: string,
    @OptionalStoreId() storeId: string | null,
    @UserId() userId: string,
    @Body(new ZodValidationPipe(agentCreateSchema)) body: AgentCreateInput,
  ) {
    return this.agents.createAgent(companyId, storeId, body, userId);
  }

  @Patch('service-agents/:agentId')
  @DocUpdateAgent()
  updateAgent(
    @CompanyId() companyId: string,
    @UserId() userId: string,
    @Param('agentId') agentId: string,
    @Body(new ZodValidationPipe(agentUpdateSchema)) body: AgentUpdateInput,
  ) {
    return this.agents.updateAgent(companyId, validId(agentId, 'agent'), body, userId);
  }

  @Patch('service-agents/:agentId/active')
  @DocSetAgentActive()
  setAgentActive(
    @CompanyId() companyId: string,
    @Param('agentId') agentId: string,
    @Body(new ZodValidationPipe(agentActiveSchema)) body: AgentActiveInput,
  ) {
    return this.agents.setAgentActive(companyId, validId(agentId, 'agent'), body.is_active);
  }

  @Put('pixnopdv-store-credentials')
  @RequireStore()
  @DocSavePixnopdv()
  savePixnopdv(
    @CompanyId() companyId: string,
    @StoreId() storeId: string,
    @Body(new ZodValidationPipe(pixnopdvPutSchema)) body: PixnopdvPutInput,
  ) {
    return this.pixnopdv.savePixnopdv(companyId, storeId, body);
  }
}
