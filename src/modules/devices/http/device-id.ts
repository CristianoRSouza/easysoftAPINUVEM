import { BadRequestException } from '@nestjs/common';
import { UUID_RE } from '../../../common/validation/uuid';

/**
 * Parâmetro de rota `:agentId` / `:totemId`: tem de ser UUID antes de chegar ao banco —
 * `'abc'::uuid` estoura no Postgres e viraria 500.
 */
export function validId(id: string, kind: 'agent' | 'totem'): string {
  const v = String(id ?? '').trim();
  if (!UUID_RE.test(v)) {
    throw new BadRequestException({
      error: `invalid_${kind}`,
      message: `${kind === 'agent' ? 'agentId' : 'totemId'} inválido.`,
    });
  }
  return v;
}
