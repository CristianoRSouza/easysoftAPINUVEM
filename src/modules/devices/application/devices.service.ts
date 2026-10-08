import { Injectable } from '@nestjs/common';
import { limiteDeAuditoria, mapAudit, mapUnifiedAudit } from '../domain/device-audit.mapper';
import {
  mapPixnopdvCredentials,
  mapProductImages,
  mapTotem,
  normalizeRow,
} from '../domain/devices.mapper';
import { AgentsRepository } from '../infrastructure/agents.repository';
import { DeviceAuditRepository } from '../infrastructure/device-audit.repository';
import { PixnopdvRepository } from '../infrastructure/pixnopdv.repository';
import { ProductImagesRepository } from '../infrastructure/product-images.repository';
import { TotemLicensesRepository } from '../infrastructure/totem-licenses.repository';
import { TotemsRepository } from '../infrastructure/totems.repository';

/**
 * Leituras de dispositivos: totens, licenças, agentes de NFC-e, PIXnoPDV e auditoria.
 *
 * Cada método é um caso de uso de leitura: busca no repositório e entrega na forma do
 * fio. O SQL (com a amarra de empresa que a RLS fazia no browser) está nos repositórios;
 * o que cada campo vira quando ausente, nos mappers de `domain/`.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly totemsRepository: TotemsRepository,
    private readonly licenses: TotemLicensesRepository,
    private readonly agentsRepository: AgentsRepository,
    private readonly audit: DeviceAuditRepository,
    private readonly pixnopdv: PixnopdvRepository,
    private readonly images: ProductImagesRepository,
  ) {}

  async agents(companyId: string, storeId: string | null) {
    return (await this.agentsRepository.list(companyId, storeId)).map(normalizeRow);
  }

  async agentAuditLogs(companyId: string, agentId: string) {
    return (await this.audit.findByAgent(companyId, agentId)).map(mapAudit);
  }

  async totemAuditLogs(companyId: string, totemId: string) {
    return (await this.audit.findByTotem(companyId, totemId)).map(mapAudit);
  }

  async unifiedAuditLogs(companyId: string, limit: number) {
    const rows = await this.audit.findUnified(companyId, limiteDeAuditoria(limit));
    return rows.map(mapUnifiedAudit);
  }

  async totems(companyId: string, storeId: string | null) {
    return (await this.totemsRepository.list(companyId, storeId)).map(mapTotem);
  }

  async totemLicenses(companyId: string, storeId: string | null) {
    return (await this.licenses.list(companyId, storeId)).map(normalizeRow);
  }

  async availableTotemLicenses(companyId: string, storeId: string | null, totemId?: string | null) {
    const rows = await this.licenses.listAvailable(companyId, storeId, totemId ?? null);
    return rows.map(normalizeRow);
  }

  /**
   * Credenciais do PIXnoPDV (produção), com os segredos redigidos — ver `pixnopdv.sql.ts`.
   * `null` quando a loja não tem credencial cadastrada, que é situação normal.
   */
  async pixnopdvCredentials(companyId: string, storeId: string) {
    const r = await this.pixnopdv.findRedigidas(companyId, storeId);
    return r ? mapPixnopdvCredentials(r) : null;
  }

  /**
   * Imagens de produto por id — a tela de Comandas usa para mostrar a foto do item.
   * Devolve um mapa `{ id: url }`. Id que não é da loja simplesmente não volta: a tela
   * mostra o item sem foto, que é o comportamento de hoje.
   */
  async productImages(storeId: string, ids: string[]): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    return mapProductImages(await this.images.findByIds(storeId, ids));
  }
}
