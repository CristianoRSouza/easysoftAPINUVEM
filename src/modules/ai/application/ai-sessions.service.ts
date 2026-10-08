import { Injectable } from '@nestjs/common';
import { AI_APP, type ChatSession } from '../../../contract/ai.schema';
import { diaEmBrasilia } from '../domain/brasilia-day.rule';
import { mapChatSession } from '../domain/chat-session.mapper';
import { AiSessionsRepository } from '../infrastructure/ai-sessions.repository';

/**
 * Histórico do chat — `billing.ai_chat_sessions`, uma linha por usuário/dia.
 *
 * ── Quem vê o quê (regra de produto, mantida da RLS anterior) ─────────────────────
 * LEITURA é da EMPRESA: qualquer membro aprovado vê as conversas da empresa. Foi uma
 * decisão deliberada (o gerente consegue rever o que a equipe perguntou ao assistente).
 * ESCRITA e APAGAR são do AUTOR: `user_id` entra no `where` de todo update/delete, e vem
 * da SESSÃO — nunca do cliente.
 *
 * Antes essa separação era feita por policies RLS avaliadas com o JWT do navegador.
 * Agora é `where` explícito, porque o role da API tem BYPASSRLS (ele É a camada
 * confiável). Trocar a barreira de lugar sem trocá-la de conteúdo é o ponto.
 *
 * O SQL (e a nota sobre o `on conflict`) está em `AiSessionsRepository`.
 */
@Injectable()
export class AiSessionsService {
  constructor(private readonly repository: AiSessionsRepository) {}

  /**
   * Dia corrente no fuso de Brasília, em `YYYY-MM-DD`.
   *
   * O servidor roda em UTC; usar a data dele viraria o dia às 21h para o usuário, e a
   * conversa em andamento saltaria para o histórico no meio do expediente.
   */
  static today(now: Date = new Date()): string {
    return diaEmBrasilia(now);
  }

  /** Conversas da empresa, mais recentes primeiro (inclui a de hoje). */
  async list(companyId: string): Promise<ChatSession[]> {
    return (await this.repository.findByCompany(companyId)).map(mapChatSession);
  }

  /**
   * Grava a conversa do dia. Lista vazia APAGA a linha — é o que a tela faz quando o
   * usuário limpa a conversa, e evita uma rota só para isso.
   */
  async upsertToday(
    userId: string,
    companyId: string,
    messages: unknown[],
    startedAt: string | undefined,
    endedAt: string | undefined,
  ): Promise<{ id: string } | null> {
    const day = AiSessionsService.today();

    if (messages.length === 0) {
      await this.repository.deleteDay(userId, companyId, day, AI_APP);
      return null;
    }

    const nowIso = new Date().toISOString();
    const row = await this.repository.upsertDay({
      userId,
      companyId,
      app: AI_APP,
      day,
      messages,
      startedAt: startedAt ?? nowIso,
      endedAt: endedAt ?? nowIso,
    });
    return row ? { id: String(row.id) } : null;
  }

  /**
   * Apaga UMA conversa — só o autor, e só dentro da empresa. Id que não case com os dois
   * devolve `deleted: 0`, não erro.
   */
  async remove(userId: string, companyId: string, id: string): Promise<{ deleted: number }> {
    return { deleted: await this.repository.deleteOne(id, userId, companyId) };
  }

  /**
   * Apaga o histórico do próprio usuário PRESERVANDO a conversa de hoje — que é a que
   * está aberta na tela. Apagar tudo faria a conversa em andamento sumir sob o usuário.
   */
  async clearHistory(userId: string, companyId: string): Promise<{ deleted: number }> {
    return {
      deleted: await this.repository.deleteAllExceptDay(
        userId,
        companyId,
        AiSessionsService.today(),
      ),
    };
  }
}
