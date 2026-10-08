import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import type { Row } from '../../../db/queryable';
import { MAX_AUDIT } from '../domain/device-audit.mapper';

/**
 * O agente pertence à EMPRESA? Toda rota filha de agente passa por aqui.
 *
 * Mesma correção feita nas filhas da NFC-e: `fetchCloudAgentAuditLogs` no browser filtra
 * **apenas por `agent_config_id`** — quem barrava agente de outra empresa era a RLS. O
 * role desta API tem BYPASSRLS, então sem esta amarra bastaria um id alheio para ler o
 * histórico de configuração fiscal de outra empresa (que inclui valores anteriores e
 * novos de cada campo alterado).
 */
const AGENT_BELONGS_TO_COMPANY = `
  exists (select 1 from public.vw_nfce_service_agent a
           where a.id = $1::uuid and a.company_id = $2::uuid)`;

/** Histórico de alterações de totens e agentes — leitura. */
@Injectable()
export class DeviceAuditRepository {
  constructor(private readonly db: DbService) {}

  async findByAgent(companyId: string, agentId: string): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select id, agent_config_id, action, changed_fields, previous_values, new_values,
              performed_by, created_at
         from public.vw_nfce_service_agent_audit
        where agent_config_id = $1::uuid and ${AGENT_BELONGS_TO_COMPANY}
        order by created_at desc
        limit ${MAX_AUDIT}`,
      [agentId, companyId],
    );
    return rows;
  }

  async findByTotem(companyId: string, totemId: string): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select id, totem_config_id, action, changed_fields, previous_values, new_values,
              performed_by, created_at
         from public.vw_devices_totem_config_audit
        where totem_config_id = $1::uuid and company_id = $2::uuid
        order by created_at desc
        limit ${MAX_AUDIT}`,
      [totemId, companyId],
    );
    return rows;
  }

  /**
   * Auditoria unificada — totens e agentes na mesma linha do tempo.
   *
   * No browser eram **quatro** consultas: as duas de auditoria mais duas só para traduzir
   * id em nome, cruzadas por `Map` em JavaScript. Aqui é um `union all` com o nome vindo
   * de LEFT JOIN.
   *
   * Quando o nome não existe (dispositivo apagado depois da alteração), cai no prefixo do
   * id — mesmo comportamento de hoje. Apagar o totem não pode apagar o rastro de quem
   * mexeu nele.
   */
  async findUnified(companyId: string, limite: number): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `(select ta.id, 'totem' as source, ta.totem_config_id as entity_id,
               coalesce(t.totem_name, left(ta.totem_config_id::text, 8)) as entity_name,
               ta.action, ta.changed_fields, ta.previous_values, ta.new_values,
               ta.performed_by, ta.created_at
          from public.vw_devices_totem_config_audit ta
          left join public.vw_devices_totem_config t on t.id = ta.totem_config_id
         where ta.company_id = $1::uuid)
       union all
       (select aa.id, 'agent' as source, aa.agent_config_id as entity_id,
               coalesce(a.agent_name, left(aa.agent_config_id::text, 8)) as entity_name,
               aa.action, aa.changed_fields, aa.previous_values, aa.new_values,
               aa.performed_by, aa.created_at
          from public.vw_nfce_service_agent_audit aa
          left join public.vw_nfce_service_agent a on a.id = aa.agent_config_id
         where aa.company_id = $1::uuid)
       order by created_at desc
       limit $2::int`,
      [companyId, limite],
    );
    return rows;
  }
}
