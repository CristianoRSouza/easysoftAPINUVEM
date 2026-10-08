import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../../config/env';
import { DbService } from '../../../db/db.service';
import { NIL_UUID, type SyncEvent } from '../domain/sync-event';

const OUTBOX_COLUMNS = `event_id, entity_name, entity_id::text AS entity_id, op, payload,
                  company_id::text AS company_id, store_id::text AS store_id`;

/**
 * Fila de sync (schema `ecb_sync`) exposta à camada 2. Replica FIELMENTE o que o
 * PgRemoteSupabaseSyncAdapter do Sync-PG-SB fazia por pg direto — mesma ordenação,
 * mesmo filtro tenant (NIL broadcast) e a MESMA idempotência (ON CONFLICT event_id DO NOTHING).
 *
 * Todo o SQL da fila mora AQUI, inclusive a única escrita sem tenant no WHERE do módulo
 * (o ack da outbox): é este arquivo que o `tenant-write-safety.guard.spec.ts` libera,
 * por ser fila @ServiceOnly e cross-tenant por desenho.
 */
@Injectable()
export class SyncRepository {
  private readonly outbox: string;
  private readonly inbox: string;

  constructor(
    private readonly db: DbService,
    @Inject(ENV) env: Env,
  ) {
    const s = env.SYNC_SCHEMA;
    // s vem do env (confiável), mas validamos como identificador seguro antes de interpolar.
    if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`SYNC_SCHEMA inválido: ${s}`);
    this.outbox = `${s}.outbox`;
    this.inbox = `${s}.inbox`;
  }

  /** Pendentes de UMA loja — mais os de broadcast (NIL UUID), destinados a todas. */
  async findPendingOutboxForTenant(
    limit: number,
    companyId: string,
    storeId: string,
  ): Promise<SyncEvent[]> {
    const r = await this.db.query<SyncEvent>(
      `SELECT ${OUTBOX_COLUMNS} FROM ${this.outbox}
         WHERE dispatch_status = 'pending'
           AND company_id IN ($2::uuid, $4::uuid)
           AND store_id   IN ($3::uuid, $4::uuid)
         ORDER BY changed_at ASC, event_id ASC
         LIMIT $1`,
      [limit, companyId, storeId, NIL_UUID],
    );
    return r.rows;
  }

  /** Pendentes da fila inteira, sem recorte de tenant. */
  async findPendingOutbox(limit: number): Promise<SyncEvent[]> {
    const r = await this.db.query<SyncEvent>(
      `SELECT ${OUTBOX_COLUMNS} FROM ${this.outbox}
       WHERE dispatch_status = 'pending'
       ORDER BY changed_at ASC, event_id ASC
       LIMIT $1`,
      [limit],
    );
    return r.rows;
  }

  /** Lote atômico (uma statement) via jsonb_to_recordset, preservando a idempotência canônica. */
  async insertInboxIgnoreDuplicates(batchJson: string, origin: 'local' | 'supabase'): Promise<void> {
    // received_at CRESCENTE na ordem do lote, não o default now(). O apply ordena por
    // received_at e desempata por event_id (UUID aleatório): com now() o lote inteiro empatava,
    // e o I de uma linha podia ser aplicado depois do U dela — foi o que zerou o vNFTot das
    // NFC-e na nuvem em 29/09/2026. A loja manda o lote na ordem da outbox (Sync-PG-SB sql/118).
    // 1 µs por posição: um lote de 5000 "ocupa" 5 ms, bem menos do que leva para ser gravado,
    // então o lote seguinte (now() depois do commit deste) nunca intercala com este.
    await this.db.query(
      `INSERT INTO ${this.inbox}
         (event_id, origin, entity_name, entity_id, op, payload, company_id, store_id, received_at)
       SELECT x.event_id, $2::text, x.entity_name, x.entity_id, x.op, x.payload, x.company_id, x.store_id,
              now() + e.ord * interval '1 microsecond'
       FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS e(doc, ord)
       CROSS JOIN LATERAL jsonb_to_record(e.doc) AS x(
         event_id uuid, entity_name text, entity_id uuid, op text,
         payload jsonb, company_id uuid, store_id uuid)
       ON CONFLICT (event_id) DO NOTHING`,
      [batchJson, origin],
    );
  }

  /** Marca `dispatched` só o que ainda estava `pending`; devolve quantos mudaram. */
  async markOutboxDispatched(eventIds: string[]): Promise<number> {
    const r = await this.db.query<{ event_id: string }>(
      `UPDATE ${this.outbox}
       SET dispatch_status = 'dispatched', dispatched_at = now()
       WHERE event_id = ANY($1::uuid[]) AND dispatch_status = 'pending'
       RETURNING event_id`,
      [eventIds],
    );
    return r.rowCount ?? r.rows.length;
  }
}
