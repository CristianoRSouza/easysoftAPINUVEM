import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AI_APP, type ChatMessage } from '../../../contract/ai.schema';
import { traduzirFalhaDaPortaDeIa } from '../domain/upstream-failure.rule';
import { EasyAiClient } from '../infrastructure/easyai.client';

/**
 * Para onde o chat escreve. É o pouco que este caso de uso precisa de uma resposta HTTP —
 * a `Response` do express serve, mas ele não precisa conhecê-la (nem o teste, montá-la).
 */
export interface SaidaSse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
  flushHeaders?(): void;
  write(chunk: Buffer): unknown;
  end(): unknown;
}

export interface ChatContext {
  userId: string;
  companyId: string;
  storeId: string;
  messages: ChatMessage[];
}

/**
 * O assistente de IA — encaminha para a porta única do ecossistema.
 *
 * ── O que este serviço deixou de fazer, e por quê ──────────────────────────────────
 * Ele já implementou o chat inteiro aqui: provedor, prompt, base de conhecimento, classificação
 * de intenção e **cobrança**. Isso foi revertido por decisão de arquitetura de 2026-08-01
 * (ADR-0003): todo consumo de IA do ecossistema passa pela porta única, o **EasyAI**.
 *
 * O motivo é concreto. Este módulo escrevia nas MESMAS tabelas `billing.usage_log` e
 * `billing.credit_transactions` que a porta — duas réguas cobrando da mesma carteira. Uma
 * correção de cobrança feita de um lado não chegava ao outro, e o mesmo cliente era cobrado de
 * formas diferentes conforme o produto por onde entrasse.
 *
 * ── O que continua sendo nosso ────────────────────────────────────────────────────
 * A rota `POST /v1/ai/chat` e o histórico de conversas. Ela é a porta do EasyFood para o
 * navegador do EasyFood: a camada de 3 níveis do produto segue intacta e o front **não percebe
 * diferença** — mesmo endereço, mesmo SSE.
 *
 * ── Sobre a ordem do débito ───────────────────────────────────────────────────────
 * A regra continua valendo, só que aplicada do outro lado: nada é cobrado antes de a resposta
 * existir. Como aqui só repassamos bytes, não há o que contabilizar.
 */
@Injectable()
export class AiChatService {
  private readonly log = new Logger(AiChatService.name);

  constructor(private readonly easyAi: EasyAiClient) {}

  /**
   * Responde o chat em SSE, escrevendo direto na resposta HTTP.
   *
   * Lança (e nada é escrito) quando a falha acontece ANTES do primeiro byte. Depois que o stream
   * começou, o status já foi enviado — aí um erro só pode ser registrado e o stream, encerrado.
   */
  async stream(ctx: ChatContext, res: SaidaSse): Promise<void> {
    if (!this.easyAi.configurado) {
      // Fail-closed explícito: sem o segredo compartilhado não há como provar ao EasyAI quem
      // é o usuário. Dizer isso é melhor que devolver erro genérico, que parece problema de rede.
      throw new ServiceUnavailableException({
        error: 'ai_not_configured',
        message: 'Assistente de IA não configurado neste ambiente.',
      });
    }

    let upstream: Response;
    try {
      upstream = await this.easyAi.conversar({
        userId: ctx.userId,
        companyId: ctx.companyId,
        storeId: ctx.storeId,
        app: AI_APP,
        messages: ctx.messages.map(({ role, content }) => ({ role, content })),
      });
    } catch (e) {
      this.log.error(`Falha ao contatar a porta de IA: ${String(e)}`);
      throw new ServiceUnavailableException({
        error: 'ai_unavailable',
        message: 'Assistente de IA indisponível no momento.',
      });
    }

    if (!upstream.ok || !upstream.body) {
      const detalhe = await upstream.text().catch(() => '');
      this.log.error(`Porta de IA respondeu ${upstream.status}: ${detalhe.slice(0, 300)}`);

      const falha = traduzirFalhaDaPortaDeIa(upstream.status, detalhe);
      throw new HttpException({ error: falha.error, message: falha.message }, falha.status);
    }

    abrirSse(res);

    // Repassa os bytes COMO VÊM. Bufferizar aqui faria o texto aparecer de uma vez na tela, em
    // vez de ir surgindo — o efeito de digitação é o que faz o chat parecer vivo.
    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch (e) {
      this.log.error(`Stream da porta de IA interrompido: ${String(e)}`);
    } finally {
      res.end();
    }
  }
}

/**
 * Cabeçalhos de SSE. `X-Accel-Buffering: no` é o que impede um proxy no caminho de segurar os
 * pedaços e entregar tudo de uma vez — sem ele o chat parece travado e depois "vomita" a resposta
 * inteira.
 */
function abrirSse(res: SaidaSse): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}
