/**
 * Recusas de REGRA que `cloud_set_totem_active` levanta por `RAISE EXCEPTION`. Sem esta
 * tradução elas viravam 500 "Erro interno" — a tela não dizia o que fazer, e o usuário
 * clicava de novo (no "Novo Totem", isso ainda batia na unicidade do nome).
 *
 * Aqui mora só a TABELA (mensagem do banco → o que dizer à tela), sem Nest: quem a
 * transforma em resposta HTTP é `application/totem-rpc-refusal.mapper.ts`.
 */
export type TipoDeRecusa = 'nao_encontrado' | 'proibido' | 'requisicao_invalida';

export interface RecusaDeTotem {
  tipo: TipoDeRecusa;
  error: string;
  message: string;
}

const RECUSAS_DA_RPC_DE_TOTEM: Record<string, RecusaDeTotem> = {
  totem_not_found: {
    tipo: 'nao_encontrado',
    error: 'totem_not_found',
    message: 'Totem não encontrado.',
  },
  totem_access_denied: {
    tipo: 'proibido',
    error: 'totem_access_denied',
    message: 'Sem acesso a este totem.',
  },
  license_required_for_active_totem: {
    tipo: 'requisicao_invalida',
    error: 'license_required',
    message: 'Para ativar o totem, vincule uma licença ativa (aba Licença).',
  },
  license_not_found: {
    tipo: 'requisicao_invalida',
    error: 'license_not_found',
    message: 'Licença não encontrada.',
  },
  license_not_available_for_totem: {
    tipo: 'requisicao_invalida',
    error: 'license_not_available',
    message:
      'Essa licença não pode ser usada neste totem: já está em outro totem, não está ativa ou é de outra loja/empresa.',
  },
  totem_activation_selected_license_not_persisted: {
    tipo: 'requisicao_invalida',
    error: 'activation_not_persisted',
    message: 'A ativação não se confirmou no banco. Tente de novo.',
  },
  totem_deactivation_not_persisted: {
    tipo: 'requisicao_invalida',
    error: 'deactivation_not_persisted',
    message: 'A desativação não se confirmou no banco. Tente de novo.',
  },
};

/** A recusa conhecida que corresponde ao erro do banco; null para o resto. */
export function recusaConhecidaDaRpcDeTotem(e: unknown): RecusaDeTotem | null {
  const msg = e instanceof Error ? e.message.trim() : '';
  // Só chave PRÓPRIA: uma mensagem como "constructor" acharia o que o objeto herda do
  // protótipo, e isso não é recusa nenhuma.
  return Object.prototype.hasOwnProperty.call(RECUSAS_DA_RPC_DE_TOTEM, msg)
    ? RECUSAS_DA_RPC_DE_TOTEM[msg]
    : null;
}
