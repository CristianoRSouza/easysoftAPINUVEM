import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { recusaConhecidaDaRpcDeTotem, type TipoDeRecusa } from '../domain/totem-rpc-refusals';

const EXCECAO_POR_TIPO: Record<
  TipoDeRecusa,
  new (corpo: { error: string; message: string }) => HttpException
> = {
  nao_encontrado: NotFoundException,
  proibido: ForbiddenException,
  requisicao_invalida: BadRequestException,
};

/**
 * Traduz a recusa conhecida da RPC; devolve null para o resto (que segue como 500).
 *
 * Fica na camada de aplicação de propósito: o repositório deixa o erro do banco subir
 * como veio, e é o caso de uso que decide que aquela mensagem é uma recusa de regra.
 */
export function recusaDaRpcDeTotem(e: unknown): HttpException | null {
  const recusa = recusaConhecidaDaRpcDeTotem(e);
  if (!recusa) return null;
  return new EXCECAO_POR_TIPO[recusa.tipo]({ error: recusa.error, message: recusa.message });
}
