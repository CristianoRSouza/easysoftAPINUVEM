import { ApiBody, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { ApiDocs, ApiSessionErrorResponses, ApiTenantHeaders } from '../../../common/swagger';

/**
 * Documentação OpenAPI das rotas do assistente — fora do controller, para ele mostrar só o
 * que decide o comportamento (rota, guard, entrada, caso de uso).
 *
 * Cada `Doc*` equivale a empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

export const DocChat = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Conversa com o assistente (resposta em streaming SSE)',
      description:
        'Substitui a edge function `ai-chat`. A resposta é `text/event-stream` no formato de ' +
        '`chat/completions` (`data: {choices:[{delta:{content}}]}` … `data: [DONE]`) — a mesma que a ' +
        'tela já consome, para a troca ser invisível.\n\n' +
        '**A IA não é executada aqui.** Esta rota encaminha a conversa para a porta única de IA do ' +
        'ecossistema, o EasyAI (ADR-0003), que é dono da credencial do provedor, do prompt, da ' +
        'base de conhecimento e da **cobrança**. Aqui não existe chave de provedor nem cálculo de ' +
        'cota: enquanto existiram, eram duas réguas cobrando da mesma carteira, e o mesmo cliente ' +
        'pagava diferente conforme o produto por onde entrasse.\n\n' +
        '**Empresa e loja NÃO vêm no corpo.** Saem do `TenantGuard` (`X-Company-Id`/`X-Store-Id`, já ' +
        'validados contra o dono da sessão) e são enviados ao EasyAI, que os reconfere contra o ' +
        'vínculo real do usuário. O cliente não consegue nem tentar pedir em nome de outra empresa.\n\n' +
        '**Cobrança** (regra aplicada no EasyAI, depois de a resposta ser entregue, nunca antes): ' +
        'suporte/navegação é grátis e não consome cota; consulta de dados dentro das grátis do dia é ' +
        'grátis mas gasta um slot; acima disso debita 1 crédito, e só se houver saldo.',
    }),
    ApiTenantHeaders(true),
    ApiBody({
      required: true,
      schema: {
        type: 'object',
        required: ['messages'],
        properties: {
          messages: {
            type: 'array',
            description: 'Conversa completa, do mais antigo ao mais recente (máx. 60 mensagens).',
            items: {
              type: 'object',
              required: ['role', 'content'],
              properties: {
                role: { type: 'string', enum: ['user', 'assistant'] },
                content: { type: 'string', example: 'Onde vejo as vendas de ontem?' },
              },
            },
          },
        },
      },
    }),
    ApiResponse({ status: 200, description: 'Stream SSE com a resposta do assistente.' }),
    ApiResponse({ status: 402, description: 'Gateway de IA sem créditos (`ai_insufficient_credits`).' }),
    ApiResponse({ status: 429, description: 'Gateway de IA recusou por excesso de requisições (`ai_rate_limited`).' }),
    ApiSessionErrorResponses(),
  );

export const DocListSessions = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Histórico de conversas da empresa',
      description:
        'Conversas de `billing.ai_chat_sessions` da empresa, uma linha por usuário/dia, mais recentes ' +
        'primeiro (inclui a de hoje — a tela separa).\n\n' +
        'A leitura é da EMPRESA de propósito: qualquer membro aprovado vê as conversas, para o gestor ' +
        'conseguir rever o que a equipe perguntou. Apagar continua sendo só do autor.',
    }),
    ApiTenantHeaders(),
    ApiResponse({ status: 200, description: 'Conversas da empresa.' }),
    ApiSessionErrorResponses(),
  );

export const DocPutToday = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Grava (ou apaga) a conversa de hoje',
      description:
        'Grava a conversa do dia do usuário logado. **`messages: []` APAGA** a linha do dia — é o que a ' +
        'tela faz quando o usuário limpa a conversa, e por isso não existe uma rota só para isso.\n\n' +
        '"Hoje" é o dia de **Brasília**, não o do servidor (que roda em UTC): senão a conversa em ' +
        'andamento saltaria para o histórico às 21h.',
    }),
    ApiTenantHeaders(),
    ApiBody({
      required: true,
      schema: {
        type: 'object',
        required: ['messages'],
        properties: {
          messages: { type: 'array', items: { type: 'object' }, description: 'Máx. 200 mensagens. Vazio apaga.' },
          started_at: { type: 'string', format: 'date-time' },
          ended_at: { type: 'string', format: 'date-time' },
        },
      },
    }),
    ApiResponse({ status: 200, description: '`{ data: { id } }`, ou `{ data: null }` quando apagou.' }),
    ApiSessionErrorResponses(),
  );

export const DocRemoveSession = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Apaga uma conversa do histórico',
      description:
        'Só o AUTOR apaga: o `user_id` da sessão entra no `where`. Id de outra pessoa devolve ' +
        '`deleted: 0` em vez de 403 — responder diferente transformaria a rota num verificador de ' +
        'existência de conversa alheia.',
    }),
    ApiTenantHeaders(),
    ApiParam({ name: 'sessionId', description: 'UUID da conversa.', schema: { type: 'string', format: 'uuid' } }),
    ApiResponse({ status: 200, description: '`{ data: { deleted } }`' }),
    ApiSessionErrorResponses(),
  );

export const DocClearHistory = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Limpa o histórico do usuário (preserva a conversa de hoje)',
      description:
        'Apaga as conversas do PRÓPRIO usuário de dias anteriores. A de hoje fica: é a que está aberta ' +
        'na tela, e apagá-la faria a conversa em andamento sumir sob o usuário.',
    }),
    ApiTenantHeaders(),
    ApiResponse({ status: 200, description: '`{ data: { deleted } }`' }),
    ApiSessionErrorResponses(),
  );
