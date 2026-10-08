import {
  TOTEM_WRITABLE_KEYS,
  type TotemCreateInput,
  type TotemUpdateInput,
} from '../../../contract/totem-write.schema';
import type { Row } from '../../../db/queryable';
import type { ConfigParaRegra } from './totem-license.rule';

/** A configuração gravada do totem em edição: os três ambientes + os campos pedidos. */
export type TotemEmEdicao = Row & ConfigParaRegra;

/** Colunas comuns de um totem NOVO: o nome (obrigatório) e o que mais veio no corpo. */
export function camposDeCriacao(input: TotemCreateInput): string[] {
  const rec = input as Record<string, unknown>;
  return ['totem_name', ...TOTEM_WRITABLE_KEYS.filter((k) => k in rec)];
}

/** Colunas comuns de uma EDIÇÃO: só o que veio no corpo — o nome inclusive. */
export function camposDeEdicao(input: TotemUpdateInput): string[] {
  const rec = input as Record<string, unknown>;
  return [
    ...('totem_name' in rec ? ['totem_name'] : []),
    ...TOTEM_WRITABLE_KEYS.filter((k) => k in rec),
  ];
}

/**
 * Os três ambientes como o totem FICA depois de salvar: o que veio no corpo, e o gravado
 * para o que não veio. É sobre isto que a regra de licença decide.
 */
export function ambientesDepoisDeSalvar(
  input: TotemUpdateInput,
  prev: TotemEmEdicao,
): ConfigParaRegra {
  const rec = input as Record<string, unknown>;
  return {
    app_mode: 'app_mode' in rec ? input.app_mode : prev.app_mode,
    payment_environment:
      'payment_environment' in rec ? input.payment_environment : prev.payment_environment,
    nfce_environment: 'nfce_environment' in rec ? input.nfce_environment : prev.nfce_environment,
  };
}
