import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  AGENT_WRITABLE_KEYS,
  type AgentCreateInput,
  type AgentUpdateInput,
} from '../../../contract/agent-write.schema';
import { diffDeAuditoria } from '../domain/audit-diff';
import { AgentsRepository } from '../infrastructure/agents.repository';

/**
 * Escritas de agente de NFC-e.
 *
 * Nenhum método aceita `companyId` vindo do cliente: ele chega do `TenantGuard`, que já
 * conferiu o vínculo no banco. E todo comando leva o tenant no `WHERE` — agente de outra
 * empresa devolve 403, sem escrever nada.
 */
@Injectable()
export class AgentWriteService {
  // O contexto do log continua o da classe de origem: é por ele que se filtra o histórico.
  private readonly log = new Logger('DevicesWriteService');

  constructor(private readonly agents: AgentsRepository) {}

  /**
   * Cria um agente de NFC-e.
   *
   * `company_id`/`store_id` saem da SESSÃO, nunca do corpo — é a correção do payload que
   * o browser monta com o tenant lido do `localStorage`.
   *
   * A auditoria vai na MESMA transação do insert: gravar o agente e perder o rastro de
   * quem o criou é pior que falhar os dois. O browser faz as duas escritas soltas, então
   * uma falha no meio deixa alteração sem registro.
   */
  async createAgent(
    companyId: string,
    storeId: string | null,
    input: AgentCreateInput,
    quem: string,
  ) {
    return this.agents.emTransacao(async (c) => {
      const campos = ['agent_name', ...AGENT_WRITABLE_KEYS.filter((k) => k in input)];
      const valores = campos.map((k) => (input as Record<string, unknown>)[k]);

      const id = await this.agents.insert(c, companyId, storeId, campos, valores);
      await this.agents.insertAuditCreated(c, companyId, storeId, id, campos, input, quem);

      this.log.log(`agente criado ${id.slice(0, 8)} (empresa ${companyId.slice(0, 8)})`);
      return { ok: true, id };
    });
  }

  /**
   * Edita um agente. O nome NÃO é editável (chave única; o serviço da loja se reconhece
   * por ele) — o schema já não o aceita.
   *
   * O diff da auditoria compara o ANTERIOR com o novo e grava só o que mudou. Salvar o
   * formulário sem alterar nada não gera registro — auditoria cheia de linha vazia é
   * auditoria que ninguém lê.
   */
  async updateAgent(companyId: string, agentId: string, input: AgentUpdateInput, quem: string) {
    const campos = AGENT_WRITABLE_KEYS.filter((k) => k in input);
    if (campos.length === 0) return { ok: true, changed: [] as string[] };

    return this.agents.emTransacao(async (c) => {
      // O SELECT já carrega o tenant: se não for da empresa, para aqui.
      const prev = await this.agents.findParaEdicao(c, companyId, agentId, campos);
      if (!prev) {
        throw new ForbiddenException({
          error: 'forbidden',
          message: 'Agente não pertence a esta empresa.',
        });
      }

      const rec = input as Record<string, unknown>;
      const gravados = await this.agents.update(
        c,
        companyId,
        agentId,
        campos,
        campos.map((k) => rec[k]),
      );
      if (gravados.length === 0) {
        throw new ForbiddenException({
          error: 'forbidden',
          message: 'Agente não pertence a esta empresa.',
        });
      }

      const { mudou, de, para } = diffDeAuditoria(campos, prev, rec);
      if (mudou.length > 0) {
        await this.agents.insertAuditUpdated(c, companyId, agentId, mudou, de, para, quem);
      }

      this.log.log(`agente ${agentId.slice(0, 8)} atualizado: ${mudou.join(', ') || '(nada)'}`);
      return { ok: true, changed: mudou };
    });
  }

  /**
   * Ativa/desativa um agente de NFC-e.
   *
   * Aqui o tenant vai no **próprio `WHERE`** (não há RPC): é literalmente a correção do
   * `.update({is_active}).eq("id", id)` que o browser faz. O `returning` prova que a
   * linha existia e era da empresa — se voltar vazio, não houve escrita.
   */
  async setAgentActive(companyId: string, agentId: string, isActive: boolean) {
    const gravados = await this.agents.setActive(companyId, agentId, isActive);
    if (gravados.length === 0) {
      throw new ForbiddenException({
        error: 'forbidden',
        message: 'Agente não pertence a esta empresa.',
      });
    }
    this.log.log(
      `agente ${agentId.slice(0, 8)} is_active=${isActive} (empresa ${companyId.slice(0, 8)})`,
    );
    return { ok: true, id: gravados[0].id };
  }
}
