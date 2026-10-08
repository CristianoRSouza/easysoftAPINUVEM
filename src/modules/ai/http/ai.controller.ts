import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { RequireStore } from '../../../common/decorators';
import { CompanyId, StoreId, UserId } from '../../../common/http/request.decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiSessionAuth } from '../../../common/swagger';
import { UUID_RE } from '../../../common/validation/uuid';
import {
  chatRequestSchema,
  upsertTodaySessionSchema,
  type ChatRequest,
  type UpsertTodaySession,
} from '../../../contract/ai.schema';
import { AiChatService } from '../application/ai-chat.service';
import { AiSessionsService } from '../application/ai-sessions.service';
import {
  DocChat,
  DocClearHistory,
  DocListSessions,
  DocPutToday,
  DocRemoveSession,
} from './ai.docs';

/**
 * Assistente de IA — chat e histórico de conversas.
 *
 * O chat exige LOJA (`@RequireStore()`) porque a cota grátis e o crédito são por loja:
 * sem saber de qual loja se fala, não há como cobrar nem contar. O histórico é da
 * EMPRESA — qualquer membro aprovado lê, só o autor apaga.
 */
@ApiTags('Assistente IA')
@ApiSessionAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly chat: AiChatService,
    private readonly sessions: AiSessionsService,
  ) {}

  @Post('chat')
  @RequireStore()
  @DocChat()
  async postChat(
    @UserId() userId: string,
    @CompanyId() companyId: string,
    @StoreId() storeId: string,
    @Res() res: Response,
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequest,
  ): Promise<void> {
    await this.chat.stream({ userId, companyId, storeId, messages: body.messages }, res);
  }

  @Get('sessions')
  @DocListSessions()
  async listSessions(@CompanyId() companyId: string) {
    return { data: await this.sessions.list(companyId) };
  }

  @Put('sessions/today')
  @DocPutToday()
  async putToday(
    @UserId() userId: string,
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(upsertTodaySessionSchema)) body: UpsertTodaySession,
  ) {
    return {
      data: await this.sessions.upsertToday(
        userId,
        companyId,
        body.messages,
        body.started_at,
        body.ended_at,
      ),
    };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(200)
  @DocRemoveSession()
  async removeSession(
    @UserId() userId: string,
    @CompanyId() companyId: string,
    @Param('sessionId') sessionId: string,
  ) {
    if (!UUID_RE.test(String(sessionId ?? '').trim())) {
      throw new BadRequestException({ error: 'invalid_session', message: 'sessionId inválido.' });
    }
    return { data: await this.sessions.remove(userId, companyId, sessionId) };
  }

  @Delete('sessions')
  @HttpCode(200)
  @DocClearHistory()
  async clearHistory(@UserId() userId: string, @CompanyId() companyId: string) {
    return { data: await this.sessions.clearHistory(userId, companyId) };
  }
}
