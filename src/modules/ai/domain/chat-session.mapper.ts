import { toIso } from '../../../common/mapping/coerce';
import type { ChatSession } from '../../../contract/ai.schema';
import type { Row } from '../../../db/queryable';

/** Linha de `billing.ai_chat_sessions` → forma do fio. Pura: não consulta nem lança. */
export function mapChatSession(r: Row): ChatSession {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    day: String(r.day),
    app: r.app != null ? String(r.app) : null,
    // `messages` é jsonb: já chega como array. Blindado porque uma linha torta
    // (objeto, null) faria a tela quebrar num `.map`.
    messages: Array.isArray(r.messages) ? r.messages : [],
    started_at: toIso(r.started_at),
    ended_at: toIso(r.ended_at),
  };
}
