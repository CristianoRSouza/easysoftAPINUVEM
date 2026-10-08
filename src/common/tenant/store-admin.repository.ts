import { Injectable } from '@nestjs/common';
import { PODE_ADMINISTRAR_LOJA_SQL } from './pode-administrar-loja';
import { DbService } from '../../db/db.service';
import { ServiceRole } from '../../db/service-role';

/**
 * "Esta pessoa pode administrar esta loja?" — a pergunta, feita ao banco.
 *
 * Mora em `common/` porque mais de um módulo pergunta (códigos de primeiro acesso, cifra
 * de segredo TEF) e a resposta não pode divergir entre eles.
 *
 * A regra (papel OU concessão) é a de `PODE_ADMINISTRAR_LOJA_SQL`; aqui só se pergunta,
 * pelo chokepoint `rbac-authz`. Quem decide o que fazer com a resposta é o service.
 */
@Injectable()
export class StoreAdminRepository {
  constructor(
    private readonly db: DbService,
    private readonly serviceRole: ServiceRole,
  ) {}

  async canAdminister(userId: string, storeId: string): Promise<boolean> {
    const allowed = await this.serviceRole.run('rbac-authz', () =>
      this.db.query<{ ok: boolean }>(PODE_ADMINISTRAR_LOJA_SQL, [userId, storeId]),
    );
    return allowed.rows[0]?.ok === true;
  }
}
