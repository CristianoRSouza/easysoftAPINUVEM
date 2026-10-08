import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { ENV, type Env } from '../../../config/env';

/**
 * Cliente da porta única de IA do ecossistema (EasyAI).
 *
 * ── Por que a IA não mora mais aqui ───────────────────────────────────────────────
 * Decisão de 2026-08-01 (ADR-0003): **todo consumo de IA do ecossistema passa pelo EasyAI**, um
 * serviço próprio — separado do hub de licenciamento de propósito, para que um problema na IA não
 * derrube a cobrança de todos os produtos. O motivo é concreto, não estético — este módulo chegou a ter chave da
 * OpenAI própria, cota própria e escrita nas MESMAS tabelas `billing.usage_log` e
 * tabelas de cobrança da porta. Duas réguas na mesma carteira: o mesmo cliente seria
 * cobrado de formas diferentes dependendo de por qual produto entrasse.
 *
 * O histórico do ecossistema confirma o risco: quando o gateway da Lovable foi descontinuado,
 * existiam três cópias da mesma lógica de chat — e duas seguiram quebradas por semanas, porque
 * ninguém tinha como saber que a outra havia mudado.
 *
 * ── O que ficou aqui, e por quê ───────────────────────────────────────────────────
 * A rota `POST /v1/ai/chat` **continua sendo nossa**. Ela é a porta do EasyFood para o navegador
 * do EasyFood — a camada de 3 níveis do produto segue intacta e o front não percebe diferença.
 * O que saiu foi o miolo: provedor, prompt, base de conhecimento e cobrança.
 *
 * ── Como autenticamos lá ──────────────────────────────────────────────────────────
 * Não dá para repassar o header do usuário: esta API emite **token opaco próprio**, que o
 * EasyAI não sabe validar. Então assinamos uma afirmação curta — "este usuário é fulano" —
 * com HMAC-SHA256 e um segredo compartilhado, no mesmo formato que o ecossistema já usa no SSO.
 *
 * O `company_id` **não** vai no token: ele viaja no corpo e o EasyAI o confere contra o
 * vínculo real do usuário. A confiança que ele nos dá é sobre QUEM é o usuário, não sobre O QUE
 * ele pode — assim, um comprometimento desta API não vira débito em empresa alheia.
 */

/** Validade do token de serviço. Curta de propósito: a chamada é feita na hora. */
const VALIDADE_SEGUNDOS = 120;

export interface ChamadaIa {
  userId: string;
  email?: string | null;
  companyId: string;
  storeId: string | null;
  app: string;
  messages: Array<{ role: string; content: string }>;
}

function base64url(valor: string | Buffer): string {
  return Buffer.from(valor).toString('base64url');
}

/** Assina o token de serviço no formato `payload.assinatura` (HMAC-SHA256, base64url). */
export function assinarTokenDeServico(
  params: { userId: string; email?: string | null; iss: string },
  segredo: string,
): string {
  const agora = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      sub: params.userId,
      email: params.email ?? undefined,
      iss: params.iss,
      iat: agora,
      exp: agora + VALIDADE_SEGUNDOS,
    }),
  );
  const assinatura = createHmac('sha256', segredo).update(payload).digest('base64url');
  return `${payload}.${assinatura}`;
}

/**
 * Encaminha a conversa para o EasyAI e devolve a resposta CRUA, para o chamador repassar o
 * stream sem tocá-lo. Bufferizar aqui faria o texto aparecer de uma vez na tela do cliente.
 */
export async function chamarPortaDeIa(
  chamada: ChamadaIa,
  config: { url: string; segredo: string; iss: string },
  signal?: AbortSignal,
): Promise<Response> {
  const token = assinarTokenDeServico(
    { userId: chamada.userId, email: chamada.email, iss: config.iss },
    config.segredo,
  );

  return fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Token': token,
    },
    body: JSON.stringify({
      messages: chamada.messages,
      company_id: chamada.companyId,
      store_id: chamada.storeId,
      app: chamada.app,
    }),
    signal,
  });
}

/** Como esta API se identifica no token de serviço (`iss`). */
const EMISSOR = 'easyfood';

/**
 * A porta de IA como dependência injetável: é AQUI que o endereço e o segredo compartilhado
 * saem do ambiente. O caso de uso só pergunta se há configuração e pede a conversa — o
 * segredo não circula por outras camadas, nem vai para log ou resposta.
 */
@Injectable()
export class EasyAiClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Sem o segredo compartilhado não há como provar ao EasyAI quem é o usuário. */
  get configurado(): boolean {
    return Boolean(this.env.AI_SERVICE_SHARED_SECRET);
  }

  /** Resposta CRUA do EasyAI (ver `chamarPortaDeIa`). Rejeita se a rede falhar. */
  async conversar(chamada: ChamadaIa, signal?: AbortSignal): Promise<Response> {
    return chamarPortaDeIa(
      chamada,
      {
        url: this.env.EASYAI_URL,
        segredo: this.env.AI_SERVICE_SHARED_SECRET,
        iss: EMISSOR,
      },
      signal,
    );
  }
}
