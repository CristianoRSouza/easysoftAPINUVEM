import { Module } from '@nestjs/common';
import { AiChatService } from './application/ai-chat.service';
import { AiSessionsService } from './application/ai-sessions.service';
import { AiController } from './http/ai.controller';
import { AiSessionsRepository } from './infrastructure/ai-sessions.repository';
import { EasyAiClient } from './infrastructure/easyai.client';

/**
 * Assistente de IA — chat em streaming e histórico de conversas.
 *
 * O chat **não é implementado aqui**: ele é encaminhado para a porta única de IA do
 * ecossistema, o EasyAI (ADR-0003). Por isso este módulo não importa mais o `BillingModule` —
 * cota, crédito e registro de uso são medidos e cobrados lá, num lugar só.
 * Enquanto a conta era feita aqui também, eram duas réguas cobrando da mesma carteira.
 *
 * O que continua sendo nosso é o histórico de conversas (`billing.ai_chat_sessions`): ele
 * pertence ao produto, não ao provedor de IA.
 */
@Module({
  controllers: [AiController],
  providers: [AiChatService, AiSessionsService, AiSessionsRepository, EasyAiClient],
})
export class AiModule {}
