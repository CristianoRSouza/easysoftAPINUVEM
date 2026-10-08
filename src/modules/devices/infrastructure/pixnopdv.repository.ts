import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import type { Row } from '../../../db/queryable';
import type { PixnopdvGravado, PixnopdvParaGravar } from '../domain/pixnopdv-credentials';
import { PIXNOPDV_SQL } from './pixnopdv.sql';

/** Credenciais do PIXnoPDV (produção) de uma loja — `devices.pixnopdv_store_credentials`. */
@Injectable()
export class PixnopdvRepository {
  constructor(private readonly db: DbService) {}

  /** A credencial com os segredos **redigidos** — ver `pixnopdv.sql.ts`. */
  async findRedigidas(companyId: string, storeId: string): Promise<Row | undefined> {
    const { rows } = await this.db.query<Row>(PIXNOPDV_SQL, [companyId, storeId]);
    return rows[0];
  }

  /**
   * A credencial como está gravada, COM os segredos. Só serve para a mescla do salvar:
   * nada do que sai daqui pode ir para uma resposta.
   */
  async findGravadas(companyId: string, storeId: string): Promise<PixnopdvGravado | null> {
    const { rows } = await this.db.query<PixnopdvGravado>(
      `select api_base_url, basic_user, basic_token, secret_key, insecure_tls, enabled
         from devices.pixnopdv_store_credentials
        where company_id = $1::uuid and store_id = $2::uuid and environment = 'producao'
        limit 1`,
      [companyId, storeId],
    );
    return rows[0] ?? null;
  }

  /**
   * Grava a credencial e devolve o `store_id` do `returning` (ausente se nada voltou).
   *
   * `on conflict` na chave natural (empresa, loja, ambiente): reenviar o mesmo formulário
   * atualiza, não duplica. O tenant está no INSERT e na condição do UPDATE.
   */
  async upsert(
    companyId: string,
    storeId: string,
    dados: PixnopdvParaGravar,
  ): Promise<string | undefined> {
    const { rows } = await this.db.query<{ store_id: string }>(
      `insert into devices.pixnopdv_store_credentials
         (company_id, store_id, environment, api_base_url, basic_user, basic_token,
          secret_key, insecure_tls, enabled, updated_at)
       values ($1::uuid, $2::uuid, 'producao', $3, $4, $5, $6, $7::boolean, $8::boolean, now())
       on conflict (company_id, store_id, environment) do update
          set api_base_url = excluded.api_base_url,
              basic_user   = excluded.basic_user,
              basic_token  = excluded.basic_token,
              secret_key   = excluded.secret_key,
              insecure_tls = excluded.insecure_tls,
              enabled      = excluded.enabled,
              updated_at   = now()
        where devices.pixnopdv_store_credentials.company_id = $1::uuid
          and devices.pixnopdv_store_credentials.store_id = $2::uuid
       returning store_id`,
      [
        companyId,
        storeId,
        dados.api_base_url,
        dados.basic_user,
        dados.basic_token,
        dados.secret_key,
        dados.insecure_tls,
        dados.enabled,
      ],
    );
    return rows[0]?.store_id;
  }
}
