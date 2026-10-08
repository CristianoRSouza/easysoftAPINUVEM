import { z } from 'zod';

/**
 * Criação e edição de agente de NFC-e.
 *
 * ⚠️ **Não há `company_id` nem `store_id` aqui** — o tenant vem do `TenantGuard`. Hoje o
 * navegador monta o payload com `company_id: tenant.companyId` lido do `localStorage`;
 * aceitar isso deixaria o cliente escolher em nome de quem grava.
 *
 * Os campos são os mesmos que a tela já edita. Os limites numéricos não são decoração:
 * `sefaz_timeout_ms` baixo demais derruba emissão que a SEFAZ demora a responder, e
 * `retry_max_attempts` alto demais transforma uma indisponibilidade em enxurrada de
 * retentativa. Os tetos aqui são a rede que a tela sozinha não garante.
 */
const positivo = (max: number) => z.number().int().positive().max(max);

const camposEditaveis = {
  is_active: z.boolean().optional(),
  install_path: z.string().max(500).nullable().optional(),
  api_rate_limit: positivo(100_000).optional(),
  log_level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  /** Teto de 5 min: além disso o totem já desistiu e o usuário está esperando à toa. */
  sefaz_timeout_ms: positivo(300_000).optional(),
  retry_max_attempts: z.number().int().min(0).max(50).optional(),
  retry_backoff_ms: z.number().int().min(0).max(600_000).optional(),
  contingency_enabled: z.boolean().optional(),
  contingency_reason: z.string().max(500).nullable().optional(),
  contingency_auto_transmit: z.boolean().optional(),
  contingency_worker_enabled: z.boolean().optional(),
  contingency_worker_interval_ms: z.number().int().min(0).max(3_600_000).optional(),
  contingency_substitution_worker_enabled: z.boolean().optional(),
  contingency_substitution_worker_interval_ms: z.number().int().min(0).max(3_600_000).optional(),
  contingency_substitution_xjust: z.string().max(500).nullable().optional(),
  contingency_sla_warn_hours: z.number().int().min(0).max(720).optional(),
  contingency_sla_block_hours: z.number().int().min(0).max(720).optional(),
  sync_service_enabled: z.boolean().optional(),
  sync_service_url: z.string().max(500).nullable().optional(),
} as const;

/** Na criação o nome é obrigatório: é a identidade do agente e tem UNIQUE no banco. */
export const agentCreateSchema = z
  .object({ agent_name: z.string().trim().min(1).max(120), ...camposEditaveis })
  .strict();
export type AgentCreateInput = z.infer<typeof agentCreateSchema>;

/**
 * Na edição o nome **não entra**: é chave única e renomear quebraria a identidade que o
 * serviço da loja usa para se reconhecer. É a mesma regra do browser (`delete
 * patch.agent_name`), aqui feita pelo schema em vez de por remoção depois.
 */
export const agentUpdateSchema = z.object(camposEditaveis).strict();
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;

/** Ordem estável para montar `INSERT`/`UPDATE` sem depender de `Object.keys`. */
export const AGENT_WRITABLE_KEYS = Object.keys(camposEditaveis) as ReadonlyArray<
  keyof typeof camposEditaveis
>;
