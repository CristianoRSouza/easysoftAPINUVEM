import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import type { Row } from '../../../db/queryable';

/** Teto de conversas devolvidas no histórico. A tela mostra ~30; o resto é folga. */
const MAX_SESSIONS = 200;

/** A conversa de um dia, como é gravada. `day` é `YYYY-MM-DD`; as datas, ISO. */
export interface ChatSessionDay {
  userId: string;
  companyId: string;
  app: string;
  day: string;
  messages: unknown[];
  startedAt: string;
  endedAt: string;
}

/**
 * `billing.ai_chat_sessions` — a única tabela de `billing.*` em que esta API escreve (o
 * guard `billing-boundary` cobra isso): é o histórico da conversa, dado do produto, não
 * insumo de cobrança.
 *
 * O role da API tem BYPASSRLS, então o recorte de quem vê e quem apaga é o `where` de
 * cada consulta, não a RLS: `company_id` em todas, `user_id` em toda escrita.
 */
@Injectable()
export class AiSessionsRepository {
  constructor(private readonly db: DbService) {}

  /** Conversas da empresa, mais recentes primeiro (inclui a de hoje). */
  async findByCompany(companyId: string): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select id, user_id, day::text as day, app, messages, started_at, ended_at
         from billing.ai_chat_sessions
        where company_id = $1::uuid
        order by day desc, ended_at desc
        limit ${MAX_SESSIONS}`,
      [companyId],
    );
    return rows;
  }

  /** Apaga a linha do dia do usuário naquele produto (`app`). */
  async deleteDay(userId: string, companyId: string, day: string, app: string): Promise<void> {
    await this.db.query(
      `delete from billing.ai_chat_sessions
          where user_id = $1::uuid and company_id = $2::uuid
            and day = $3::date and app = $4`,
      [userId, companyId, day, app],
    );
  }

  /**
   * Grava (cria ou sobrescreve) a conversa do dia e devolve o id da linha.
   *
   * ── O `on conflict` tem que casar com o índice ÚNICO de verdade ─────────────────
   * `ai_chat_sessions_user_id_day_app_company_key` é sobre QUATRO colunas:
   * `(user_id, day, app, company_id)`. Listar menos que isso não é "mais permissivo" —
   * o Postgres recusa com "there is no unique or exclusion constraint matching the ON
   * CONFLICT specification", e a gravação inteira falha.
   *
   * Foi exatamente esse o defeito do código anterior: a tela fazia
   * `upsert(..., { onConflict: "user_id,day" })` dentro de um `try/catch` que só dava
   * `console.warn`. Toda gravação falhava em silêncio e o histórico do chat NUNCA
   * persistiu (descoberto no smoke de 2026-08-01, com a tabela quase vazia em produção).
   *
   * O índice de quatro colunas também resolve, sozinho, a colisão entre produtos: dois
   * módulos Easy* no mesmo dia são duas linhas, não uma sobrescrevendo a outra.
   */
  async upsertDay(s: ChatSessionDay): Promise<{ id: string } | undefined> {
    const { rows } = await this.db.query<{ id: string }>(
      `insert into billing.ai_chat_sessions
         (user_id, company_id, app, day, messages, started_at, ended_at)
       values ($1::uuid, $2::uuid, $3, $4::date, $5::jsonb, $6::timestamptz, $7::timestamptz)
       on conflict (user_id, day, app, company_id) do update
          set messages   = excluded.messages,
              started_at = excluded.started_at,
              ended_at   = excluded.ended_at
       returning id`,
      [s.userId, s.companyId, s.app, s.day, JSON.stringify(s.messages), s.startedAt, s.endedAt],
    );
    return rows[0];
  }

  /**
   * Apaga UMA conversa. Dois recortes no `where`, e cada um cobre uma coisa:
   * `user_id` porque só o autor apaga a própria, e `company_id` porque o role da API tem
   * BYPASSRLS — sem ele, um id vazado apagaria a conversa de quem estivesse em qualquer
   * empresa. Devolve quantas linhas saíram (0 quando o id não casa com os dois).
   */
  async deleteOne(id: string, userId: string, companyId: string): Promise<number> {
    const { rowCount } = await this.db.query(
      `delete from billing.ai_chat_sessions
        where id = $1::uuid and user_id = $2::uuid and company_id = $3::uuid`,
      [id, userId, companyId],
    );
    return rowCount ?? 0;
  }

  /**
   * Apaga as conversas do usuário na empresa, MENOS a do dia informado.
   *
   * O recorte é também por empresa: quem trabalha em duas empresas limpa o histórico de
   * uma sem levar junto o da outra.
   */
  async deleteAllExceptDay(userId: string, companyId: string, day: string): Promise<number> {
    const { rowCount } = await this.db.query(
      `delete from billing.ai_chat_sessions
        where user_id = $1::uuid and company_id = $2::uuid and day <> $3::date`,
      [userId, companyId, day],
    );
    return rowCount ?? 0;
  }
}
