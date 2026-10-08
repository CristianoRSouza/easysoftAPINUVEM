import { z } from 'zod';

/**
 * Assistente de IA — chat e histórico de conversas.
 *
 * Migra a edge function `ai-chat` do Manager-Web. A diferença que importa não é o
 * transporte: é DE ONDE vêm empresa e loja. A edge recebia `company_id`/`store_id` no
 * corpo da requisição e reconferia o vínculo na unha; aqui eles NÃO existem no corpo —
 * vêm do `TenantGuard` (headers já validados contra o dono da sessão). Um cliente não
 * consegue nem tentar pedir o chat "em nome de" outra empresa.
 */

/** Uma mensagem da conversa. `content` é limitado para o prompt não virar upload. */
export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(20_000),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * Corpo de `POST /ai/chat`.
 *
 * Sem `company_id`, sem `store_id` e sem `app`: os dois primeiros vêm do guard, o
 * terceiro é constante deste produto. Aceitar qualquer um deles do cliente seria deixar
 * a tela escolher em nome de quem a IA lê dados e em qual base de conhecimento ela se
 * apoia — decisões que são do servidor.
 */
export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(60),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Uma conversa arquivada (uma linha de `billing.ai_chat_sessions` — uma por usuário/dia). */
export const chatSessionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  day: z.string(),
  app: z.string().nullable(),
  messages: z.array(chatMessageSchema.passthrough()),
  started_at: z.string(),
  ended_at: z.string(),
});
export type ChatSession = z.infer<typeof chatSessionSchema>;

/**
 * Corpo de `PUT /ai/sessions/today` — grava (ou apaga) a conversa do dia.
 *
 * `messages: []` APAGA a linha do dia. É o que a tela faz quando o usuário limpa a
 * conversa, e manter esse significado aqui evita uma rota só para isso.
 */
export const upsertTodaySessionSchema = z.object({
  messages: z.array(chatMessageSchema.passthrough()).max(200),
  started_at: z.string().datetime().optional(),
  ended_at: z.string().datetime().optional(),
});
export type UpsertTodaySession = z.infer<typeof upsertTodaySessionSchema>;

/**
 * Identificador deste produto na base de conhecimento (`billing.ai_kb_topics.app`) e na
 * coluna `app` do histórico. É CONSTANTE, não parâmetro: o cliente não escolhe qual
 * assistente está falando com ele.
 */
export const AI_APP = 'easyfood-manager';

/** Nome de exibição usado quando a KB não trouxer `display_name`. */
export const AI_PRODUCT_NAME = 'EasyFood Manager';
