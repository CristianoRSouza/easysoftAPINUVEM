import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import type { Queryable, Row } from '../../../db/queryable';
import type { LicencaParaRegra } from '../domain/totem-license.rule';
import { TOTEM_AVAILABLE_LICENSES_SQL, TOTEM_LICENSES_SQL } from './totems.sql';

/**
 * Licenças de totem (`billing.device_licenses`). Só LÊ o billing — escrever ali é do
 * produto de billing, e há um guard que quebra o build se alguém tentar.
 *
 * Os métodos que aceitam `c` existem porque a leitura da licença acontece DENTRO da
 * transação da edição — usar o pool ali pegaria outra conexão, fora da transação, e a
 * regra julgaria um estado que não é o que está sendo gravado.
 */
@Injectable()
export class TotemLicensesRepository {
  constructor(private readonly db: DbService) {}

  async list(companyId: string, storeId: string | null): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(TOTEM_LICENSES_SQL, [companyId, storeId]);
    return rows;
  }

  async listAvailable(
    companyId: string,
    storeId: string | null,
    totemId: string | null,
  ): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(TOTEM_AVAILABLE_LICENSES_SQL, [
      companyId,
      storeId,
      totemId,
    ]);
    return rows;
  }

  /** A licença que a regra vai julgar. Sem id não há consulta a fazer. */
  async findParaRegra(licenseId: string | null, c?: Queryable): Promise<LicencaParaRegra | null> {
    if (!licenseId) return null;
    const onde: Queryable = c ?? this.db;
    const { rows } = await onde.query<LicencaParaRegra>(
      `select license_type, plan_slug from billing.device_licenses where id = $1::uuid`,
      [licenseId],
    );
    return rows[0] ?? null;
  }

  /** Id da licença ATIVA de totem hoje vinculada a ele (a mais recente), ou null. */
  async findIdAtivaDoTotem(totemId: string): Promise<string | null> {
    const { rows } = await this.db.query<{ id: string }>(
      `select id from billing.device_licenses
        where totem_config_id = $1::uuid and device_type = 'totem' and status = 'active'
        order by updated_at desc nulls last, id
        limit 1`,
      [totemId],
    );
    return rows[0]?.id ?? null;
  }

  /** A licença hoje vinculada ao totem — é ela que vale quando ninguém informa outra. */
  async findDoTotem(totemId: string, c?: Queryable): Promise<LicencaParaRegra | null> {
    const onde: Queryable = c ?? this.db;
    const { rows } = await onde.query<LicencaParaRegra>(
      `select license_type, plan_slug from billing.device_licenses
        where totem_config_id = $1::uuid limit 1`,
      [totemId],
    );
    return rows[0] ?? null;
  }
}
