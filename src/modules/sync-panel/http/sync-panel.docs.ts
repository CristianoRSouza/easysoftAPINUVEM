import { ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ApiDocs, ApiSessionErrorResponses, ApiTenantHeaders } from '../../../common/swagger';

/**
 * Documentação OpenAPI do painel de sincronização. As 17 rotas têm a mesma forma — o que
 * muda é o texto e se a rota aceita `limit`/`offset` — então um construtor só (`painel`)
 * monta a pilha, na mesma ordem em que os decorators ficavam sobre cada método.
 */

const listSchema = {
  type: 'object' as const,
  properties: { data: { type: 'array', items: { type: 'object', additionalProperties: true } } },
};

const NOTA_TENANT =
  'A empresa e a loja vêm do `TenantGuard` (já conferidas no banco), não do cliente. No ' +
  'browser elas saíam do `localStorage` e a RLS era a única barreira — mesma RPC, tenant ' +
  'que agora não dá para forjar.';

interface DocDoPainel {
  summary: string;
  /** Frase própria da rota, posta ANTES da nota de tenant. */
  lead?: string;
  /** Descrição da resposta 200. */
  ok: string;
  /** `limit` — as rotas de lista. `limit+offset` — as `recent-all`, paginadas. */
  paging?: 'limit' | 'limit+offset';
}

const painel = ({ summary, lead, ok, paging }: DocDoPainel) =>
  ApiDocs(
    ApiOperation({ summary, description: lead ? `${lead} ${NOTA_TENANT}` : NOTA_TENANT }),
    ApiTenantHeaders(),
    ...(paging
      ? [
          ApiQuery({
            name: 'limit',
            required: false,
            schema: { type: 'integer', default: 50, maximum: 500 },
          }),
        ]
      : []),
    ...(paging === 'limit+offset'
      ? [ApiQuery({ name: 'offset', required: false, schema: { type: 'integer', default: 0 } })]
      : []),
    ApiResponse({ status: 200, description: ok, schema: listSchema }),
    ApiSessionErrorResponses(),
  );

// ── Inbox ──────────────────────────────────────────────────────────────────

export const DocInboxSummary = () =>
  painel({ summary: 'Fila recebida — contagem por situação', ok: 'Contagens.' });

export const DocInboxByEntity = () =>
  painel({ summary: 'Fila recebida — volume por tipo de entidade', ok: 'Volume por entidade.' });

export const DocInboxFailuresByError = () =>
  painel({ summary: 'Fila recebida — falhas agrupadas por erro', ok: 'Falhas por mensagem.' });

export const DocInboxBacklog = () =>
  painel({
    summary: 'Fila recebida — acumulado e idade do mais antigo',
    lead: 'É o número que diz se a sincronização está atrasada.',
    ok: 'Backlog.',
  });

export const DocInboxApplyRate = () =>
  painel({ summary: 'Fila recebida — ritmo de aplicação', ok: 'Ritmo.' });

export const DocInboxActiveRetries = () =>
  painel({
    summary: 'Fila recebida — em retentativa agora',
    ok: 'Retentativas ativas.',
    paging: 'limit',
  });

export const DocInboxRecentFailures = () =>
  painel({ summary: 'Fila recebida — últimas falhas', ok: 'Falhas recentes.', paging: 'limit' });

export const DocInboxRecentApplied = () =>
  painel({
    summary: 'Fila recebida — últimos aplicados',
    ok: 'Aplicados recentes.',
    paging: 'limit',
  });

export const DocInboxRecentAll = () =>
  painel({
    summary: 'Fila recebida — movimento recente, paginado',
    ok: 'Movimento recente.',
    paging: 'limit+offset',
  });

// ── Outbox ─────────────────────────────────────────────────────────────────

export const DocOutboxSummary = () =>
  painel({ summary: 'Fila a enviar — contagem por situação', ok: 'Contagens.' });

export const DocOutboxByEntity = () =>
  painel({ summary: 'Fila a enviar — volume por tipo de entidade', ok: 'Volume por entidade.' });

export const DocOutboxFailuresByError = () =>
  painel({ summary: 'Fila a enviar — falhas agrupadas por erro', ok: 'Falhas por mensagem.' });

export const DocOutboxBacklog = () =>
  painel({
    summary: 'Fila a enviar — acumulado e idade do mais antigo',
    lead: 'Backlog alto aqui significa loja sem receber atualização.',
    ok: 'Backlog.',
  });

export const DocOutboxDispatchRate = () =>
  painel({ summary: 'Fila a enviar — ritmo de despacho', ok: 'Ritmo.' });

export const DocOutboxActiveRetries = () =>
  painel({
    summary: 'Fila a enviar — em retentativa agora',
    ok: 'Retentativas ativas.',
    paging: 'limit',
  });

export const DocOutboxRecentFailures = () =>
  painel({ summary: 'Fila a enviar — últimas falhas', ok: 'Falhas recentes.', paging: 'limit' });

export const DocOutboxRecentAll = () =>
  painel({
    summary: 'Fila a enviar — movimento recente, paginado',
    ok: 'Movimento recente.',
    paging: 'limit+offset',
  });
