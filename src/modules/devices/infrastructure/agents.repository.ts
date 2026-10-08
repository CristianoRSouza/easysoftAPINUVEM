import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import type { Queryable, Row } from '../../../db/queryable';

/**
 * Agentes de NFC-e no banco. O role desta API tem `BYPASSRLS`: **todo comando daqui leva
 * o tenant no `WHERE`**, não só o id — desativar o agente de NFC-e de outra empresa é
 * parar a emissão de nota na loja dela.
 */
@Injectable()
export class AgentsRepository {
  constructor(private readonly db: DbService) {}

  /** Abre a transação da escrita; os métodos que recebem `c` rodam dentro dela. */
  emTransacao<T>(fn: (c: Queryable) => Promise<T>): Promise<T> {
    return this.db.withTransaction(fn);
  }

  /**
   * Agentes de NFC-e da empresa.
   *
   * `store_id is null` entra de propósito: agente **global da empresa** é configuração
   * válida (um serviço atendendo todas as lojas). Filtrar só pela loja escolhida sumiria
   * com ele da tela.
   */
  async list(companyId: string, storeId: string | null): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select id, company_id, store_id, agent_name, is_active, api_rate_limit, log_level,
              sefaz_timeout_ms, retry_max_attempts, retry_backoff_ms,
              contingency_enabled, contingency_reason, contingency_auto_transmit,
              contingency_worker_enabled, contingency_worker_interval_ms,
              contingency_substitution_worker_enabled,
              contingency_substitution_worker_interval_ms, contingency_substitution_xjust,
              contingency_sla_warn_hours, contingency_sla_block_hours,
              sync_service_enabled, sync_service_url, install_path,
              created_at, updated_at
         from public.vw_nfce_service_agent
        where company_id = $1::uuid
          and ($2::uuid is null or store_id = $2::uuid or store_id is null)
        order by agent_name`,
      [companyId, storeId],
    );
    return rows;
  }

  /** Insere o agente. `campos`/`valores` andam em par; o tenant ocupa `$1` e `$2`. */
  async insert(
    c: Queryable,
    companyId: string,
    storeId: string | null,
    campos: readonly string[],
    valores: readonly unknown[],
  ): Promise<string> {
    const placeholders = campos.map((_, i) => `$${i + 3}`);
    const { rows } = await c.query<{ id: string }>(
      `insert into public.vw_nfce_service_agent (company_id, store_id, ${campos.join(', ')})
         values ($1::uuid, $2::uuid, ${placeholders.join(', ')})
         returning id`,
      [companyId, storeId, ...valores],
    );
    return rows[0].id;
  }

  async insertAuditCreated(
    c: Queryable,
    companyId: string,
    storeId: string | null,
    agentId: string,
    campos: readonly string[],
    novosValores: Record<string, unknown>,
    quem: string,
  ): Promise<void> {
    await c.query(
      `insert into public.vw_nfce_service_agent_audit
           (company_id, store_id, agent_config_id, action, changed_fields,
            previous_values, new_values, performed_by)
         values ($1::uuid, $2::uuid, $3::uuid, 'created', $4::text[], '{}'::jsonb, $5::jsonb, $6)`,
      [companyId, storeId, agentId, campos, JSON.stringify(novosValores), quem],
    );
  }

  /**
   * Os valores atuais dos campos que vão ser alterados (para o diff da auditoria).
   * O SELECT já carrega o tenant: `undefined` = não é desta empresa.
   */
  async findParaEdicao(
    c: Queryable,
    companyId: string,
    agentId: string,
    campos: readonly string[],
  ): Promise<Row | undefined> {
    const { rows } = await c.query<Row>(
      `select ${campos.join(', ')} from public.vw_nfce_service_agent
          where id = $1::uuid and company_id = $2::uuid`,
      [agentId, companyId],
    );
    return rows[0];
  }

  /** Grava a edição. Devolve as linhas do `returning`: vazio = nada foi escrito. */
  async update(
    c: Queryable,
    companyId: string,
    agentId: string,
    campos: readonly string[],
    valores: readonly unknown[],
  ): Promise<Array<{ id: string }>> {
    const sets = campos.map((k, i) => `${k} = $${i + 3}`);
    const { rows } = await c.query<{ id: string }>(
      `update public.vw_nfce_service_agent
            set ${sets.join(', ')}, updated_at = now()
          where id = $1::uuid and company_id = $2::uuid
          returning id`,
      [agentId, companyId, ...valores],
    );
    return rows;
  }

  async insertAuditUpdated(
    c: Queryable,
    companyId: string,
    agentId: string,
    campos: readonly string[],
    de: Record<string, unknown>,
    para: Record<string, unknown>,
    quem: string,
  ): Promise<void> {
    await c.query(
      `insert into public.vw_nfce_service_agent_audit
             (company_id, agent_config_id, action, changed_fields,
              previous_values, new_values, performed_by)
           values ($1::uuid, $2::uuid, 'updated', $3::text[], $4::jsonb, $5::jsonb, $6)`,
      [companyId, agentId, campos, JSON.stringify(de), JSON.stringify(para), quem],
    );
  }

  /**
   * Liga/desliga o agente. O tenant vai no **próprio `WHERE`** (não há RPC): é
   * literalmente a correção do `.update({is_active}).eq("id", id)` que o browser faz. O
   * `returning` prova que a linha existia e era da empresa — se voltar vazio, não houve
   * escrita.
   */
  async setActive(
    companyId: string,
    agentId: string,
    isActive: boolean,
  ): Promise<Array<{ id: string }>> {
    const { rows } = await this.db.query<{ id: string }>(
      `update public.vw_nfce_service_agent
          set is_active = $3::boolean, updated_at = now()
        where id = $1::uuid and company_id = $2::uuid
        returning id`,
      [agentId, companyId, isActive],
    );
    return rows;
  }
}
