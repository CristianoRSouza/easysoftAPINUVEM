import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  SYNC_PANEL_RPCS,
  syncPanelRoute,
  type SyncPanelPath,
  type SyncPanelRoute,
} from '../domain/sync-panel.catalog';
import { parseOptionalInt, resolveLimit, resolveOffset } from '../domain/sync-panel-paging.rule';
import { mapPanelRow } from '../domain/sync-panel.mapper';
import { SyncPanelRepository } from '../infrastructure/sync-panel.repository';

/** `limit`/`offset` como vieram na query string — a conversão é do domínio, não da rota. */
export interface SyncPanelRawPaging {
  limit?: string;
  offset?: string;
}

/**
 * Painel de sincronização. Um caminho de código para as 17 rotas.
 *
 * O tenant vem do `TenantGuard` (já conferido no banco), não do cliente — é a única
 * diferença real em relação ao browser, onde empresa e loja saíam do `localStorage`.
 */
@Injectable()
export class SyncPanelService {
  constructor(private readonly repository: SyncPanelRepository) {}

  /** Entrada das rotas: resolve o descritor pelo path e converte a paginação crua. */
  async run(
    path: SyncPanelPath,
    companyId: string,
    storeId: string | null,
    paging: SyncPanelRawPaging = {},
  ): Promise<unknown[]> {
    return this.call(
      syncPanelRoute(path),
      companyId,
      storeId,
      parseOptionalInt(paging.limit),
      parseOptionalInt(paging.offset),
    );
  }

  async call(
    route: SyncPanelRoute,
    companyId: string,
    storeId: string | null,
    limit?: number,
    offset?: number,
  ): Promise<unknown[]> {
    // Cinto e suspensório: o nome da função só pode vir do catálogo. Hoje o roteamento é
    // por rota fixa, mas se um dia virar parâmetro, esta checagem já está no caminho.
    if (!SYNC_PANEL_RPCS.has(route.rpc)) {
      throw new InternalServerErrorException({
        error: 'internal_error',
        message: 'Função de painel desconhecida.',
      });
    }

    const rows = await this.repository.callRpc(route.rpc, companyId, storeId, {
      limit: route.limit ? resolveLimit(route, limit) : undefined,
      offset: route.offset ? resolveOffset(offset) : undefined,
    });
    return rows.map(mapPanelRow);
  }
}
