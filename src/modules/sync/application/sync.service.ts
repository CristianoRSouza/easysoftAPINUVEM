import { Injectable } from '@nestjs/common';
import { toInboxBatchJson, type SyncEvent } from '../domain/sync-event';
import { SyncRepository } from '../infrastructure/sync.repository';

/**
 * Fila de sync para o worker das lojas: pull da outbox, push na inbox e ack do despacho.
 * O SQL — e a fidelidade ao adapter que ele substituiu — está em `SyncRepository`.
 */
@Injectable()
export class SyncService {
  constructor(private readonly repository: SyncRepository) {}

  /**
   * `companyId`/`storeId` andam em PAR: só com os dois o pull é recortado por tenant;
   * informar um só é o mesmo que não informar nenhum, e a varredura é global.
   */
  async fetchPendingOutbox(limit: number, companyId?: string, storeId?: string): Promise<SyncEvent[]> {
    if (companyId && storeId) {
      return this.repository.findPendingOutboxForTenant(limit, companyId, storeId);
    }
    return this.repository.findPendingOutbox(limit);
  }

  /** `received` conta o que foi ENVIADO, não o que foi gravado: reenvio é idempotente. */
  async insertInboxIgnoreDuplicates(
    origin: 'local' | 'supabase',
    rows: SyncEvent[],
  ): Promise<{ received: number }> {
    if (rows.length === 0) return { received: 0 };
    await this.repository.insertInboxIgnoreDuplicates(toInboxBatchJson(rows), origin);
    return { received: rows.length };
  }

  async markOutboxDispatched(eventIds: string[]): Promise<{ updated: number }> {
    if (eventIds.length === 0) return { updated: 0 };
    return { updated: await this.repository.markOutboxDispatched(eventIds) };
  }
}
