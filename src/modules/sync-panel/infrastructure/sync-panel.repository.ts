import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import type { Row } from '../../../db/queryable';

/** `p_limit`/`p_offset` já resolvidos. Ausente = a RPC não tem o parâmetro. */
export interface SyncPanelPaging {
  limit?: number;
  offset?: number;
}

/**
 * Chamada das RPCs `cloud_sync_*` do painel. Uma consulta para as 17 rotas.
 *
 * `rpc` é interpolado no SQL: quem chama garante que o nome saiu do catálogo
 * (`SyncPanelService` confere contra `SYNC_PANEL_RPCS` antes de chegar aqui).
 */
@Injectable()
export class SyncPanelRepository {
  constructor(private readonly db: DbService) {}

  async callRpc(
    rpc: string,
    companyId: string,
    storeId: string | null,
    paging: SyncPanelPaging = {},
  ): Promise<Row[]> {
    const params: unknown[] = [companyId, storeId];
    const args = ['p_company_id => $1::uuid', 'p_store_id => $2::uuid'];

    if (paging.limit !== undefined) {
      params.push(paging.limit);
      args.push(`p_limit => $${params.length}::int`);
    }
    if (paging.offset !== undefined) {
      params.push(paging.offset);
      args.push(`p_offset => $${params.length}::int`);
    }

    // Argumentos NOMEADOS (`p_company_id => $1`): se alguém reordenar os parâmetros da
    // RPC no banco, a chamada quebra em vez de trocar empresa por loja em silêncio — que
    // seria um vazamento sem erro nenhum.
    const { rows } = await this.db.query<Row>(
      `select * from public.${rpc}(${args.join(', ')})`,
      params,
    );
    return rows;
  }
}
