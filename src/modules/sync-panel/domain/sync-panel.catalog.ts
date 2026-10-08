/**
 * Painel de sincronização (fila da nuvem) — 17 rotas sobre 17 RPCs.
 *
 * ── O achado agradável ────────────────────────────────────────────────────────
 * Ao contrário do resto do `cloud-data.ts` — onde a varredura encontrou 44 consultas sem
 * recorte de tenant — **estas RPCs já nascem com `p_company_id` e `p_store_id`**. Quem as
 * escreveu pensou no isolamento.
 *
 * A diferença que a migração faz aqui é de ORIGEM do parâmetro: no browser, a empresa e a
 * loja vinham do `localStorage`, ou seja, o cliente declarava em nome de quem consultava e
 * a RLS era a única barreira. Aqui vêm do `TenantGuard`, que já conferiu o vínculo no
 * banco. Mesma RPC, tenant que não dá para forjar.
 *
 * ── Por que catálogo e não 17 métodos ─────────────────────────────────────────
 * As 17 rotas fazem a MESMA coisa: chamar uma função com (empresa, loja) e, em algumas,
 * um limite. Dezessete métodos quase idênticos garantem que um dia um deles diverge por
 * descuido. Rota nova = uma linha aqui.
 *
 * Os nomes de rota são os MESMOS que a Admin-API da loja já serve (`/v1/sync/inbox/summary`
 * e cia.) — é o contrato compartilhado, com duas implementações.
 */

export interface SyncPanelRoute {
  /** Segmento após `/v1/sync/`: ex. `inbox/summary`. */
  path: string;
  /** RPC correspondente. */
  rpc: string;
  /** A RPC aceita `p_limit`? */
  limit?: boolean;
  /** A RPC aceita `p_offset`? (só as `recent-all`, que são paginadas) */
  offset?: boolean;
  defaultLimit?: number;
  summary: string;
}

const ROUTES = [
  // ── Inbox: o que a nuvem RECEBEU da loja ──────────────────────────────────
  { path: 'inbox/summary', rpc: 'cloud_sync_inbox_summary',
    summary: 'Contagem por situação (pendente, aplicado, falho)' },
  { path: 'inbox/by-entity', rpc: 'cloud_sync_inbox_by_entity',
    summary: 'Volume por tipo de entidade' },
  { path: 'inbox/failures-by-error', rpc: 'cloud_sync_inbox_failures_by_error',
    summary: 'Falhas agrupadas pela mensagem de erro' },
  { path: 'inbox/backlog', rpc: 'cloud_sync_inbox_backlog',
    summary: 'Fila acumulada e idade do item mais antigo' },
  { path: 'inbox/apply-rate', rpc: 'cloud_sync_inbox_apply_rate',
    summary: 'Ritmo de aplicação ao longo do tempo' },
  { path: 'inbox/active-retries', rpc: 'cloud_sync_inbox_active_retries',
    limit: true, defaultLimit: 50, summary: 'Itens em retentativa neste momento' },
  { path: 'inbox/recent-failures', rpc: 'cloud_sync_inbox_recent_failures',
    limit: true, defaultLimit: 50, summary: 'Últimas falhas' },
  { path: 'inbox/recent-applied', rpc: 'cloud_sync_inbox_recent_applied',
    limit: true, defaultLimit: 50, summary: 'Últimos itens aplicados com sucesso' },
  { path: 'inbox/recent-all', rpc: 'cloud_sync_inbox_recent_all',
    limit: true, offset: true, defaultLimit: 50, summary: 'Movimento recente, paginado' },

  // ── Outbox: o que a nuvem tem para ENVIAR à loja ──────────────────────────
  { path: 'outbox/summary', rpc: 'cloud_sync_outbox_summary',
    summary: 'Contagem por situação (pendente, despachado, falho)' },
  { path: 'outbox/by-entity', rpc: 'cloud_sync_outbox_by_entity',
    summary: 'Volume por tipo de entidade' },
  { path: 'outbox/failures-by-error', rpc: 'cloud_sync_outbox_failures_by_error',
    summary: 'Falhas agrupadas pela mensagem de erro' },
  { path: 'outbox/backlog', rpc: 'cloud_sync_outbox_backlog',
    summary: 'Fila acumulada e idade do item mais antigo' },
  { path: 'outbox/dispatch-rate', rpc: 'cloud_sync_outbox_dispatch_rate',
    summary: 'Ritmo de despacho ao longo do tempo' },
  { path: 'outbox/active-retries', rpc: 'cloud_sync_outbox_active_retries',
    limit: true, defaultLimit: 50, summary: 'Itens em retentativa neste momento' },
  { path: 'outbox/recent-failures', rpc: 'cloud_sync_outbox_recent_failures',
    limit: true, defaultLimit: 50, summary: 'Últimas falhas' },
  { path: 'outbox/recent-all', rpc: 'cloud_sync_outbox_recent_all',
    limit: true, offset: true, defaultLimit: 50, summary: 'Movimento recente, paginado' },
] as const satisfies readonly SyncPanelRoute[];

/** Os paths do catálogo, como tipo: quem pede uma rota por nome não consegue errar o nome. */
export type SyncPanelPath = (typeof ROUTES)[number]['path'];

export const SYNC_PANEL_ROUTES: readonly SyncPanelRoute[] = ROUTES;

/** O descritor de um path do catálogo. */
export function syncPanelRoute(path: SyncPanelPath): SyncPanelRoute {
  const route = SYNC_PANEL_ROUTES.find((r) => r.path === path);
  // Inalcançável enquanto `SyncPanelPath` sair do próprio catálogo; existe para o tipo fechar.
  if (!route) throw new Error(`Rota de painel fora do catálogo: ${path}`);
  return route;
}

/** Teto por resposta — histórico de fila cresce sem parar. */
export const SYNC_PANEL_MAX_LIMIT = 500;

/**
 * Nomes de RPC permitidos, derivados do catálogo. O service consulta ESTE conjunto antes
 * de montar a chamada: assim o nome da função nunca vem de string do cliente, mesmo que
 * alguém um dia troque o roteamento por um parâmetro.
 */
export const SYNC_PANEL_RPCS = new Set(SYNC_PANEL_ROUTES.map((r) => r.rpc));
