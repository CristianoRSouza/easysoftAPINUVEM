import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import type { Queryable, Row } from '../../../db/queryable';
import type { ConfigParaRegra } from '../domain/totem-license.rule';
import type { TotemEmEdicao } from '../domain/totem-write.mapper';
import { TOTEMS_SQL } from './totems.sql';

/**
 * Configuração de totem no banco — leitura, escrita e as duas RPCs.
 *
 * O role desta API tem `BYPASSRLS`: **todo comando daqui leva o tenant no `WHERE`**, não
 * só o id. As RPCs são a exceção (recebem só o id do totem), e por isso quem as chama
 * confere o vínculo antes, com `pertenceAEmpresa`.
 */
@Injectable()
export class TotemsRepository {
  constructor(private readonly db: DbService) {}

  /** Abre a transação da escrita; os métodos que recebem `c` rodam dentro dela. */
  emTransacao<T>(fn: (c: Queryable) => Promise<T>): Promise<T> {
    return this.db.withTransaction(fn);
  }

  /**
   * As duas RPCs de totem são `SECURITY DEFINER` e autorizam por **`auth.uid()`** — a
   * identidade que o Supabase injeta no JWT. Esta API não usa JWT do Supabase: conecta
   * pelo role da aplicação, e ali `auth.uid()` é **nulo**. Chamadas sem contexto morrem
   * em `totem_access_denied`.
   *
   * Por isso toda RPC de totem roda por `withClaims`, que abre a transação com
   * `request.jwt.claims` do usuário da sessão. Provado no banco: sem contexto,
   * `has_company_access()` devolve false; com contexto, true.
   *
   * ⚠️ `withClaims`, NÃO `withRls`: o `withRls` troca o papel para `authenticated`, que
   * perdeu o EXECUTE de `cloud_set_totem_active` em 07/08/2026 — e aí ativar totem morria
   * em `permission denied` (medido em homologação em 30/09/2026; produção igual). As RPCs
   * não olham o papel, só `auth.uid()`; o papel da API tem o EXECUTE.
   *
   * A checagem de empresa da API continua ANTES — a de dentro da RPC é a segunda tranca,
   * não a primeira.
   */
  private comUsuario<T>(userId: string, fn: (c: Queryable) => Promise<T>): Promise<T> {
    return this.db.withClaims({ sub: userId, role: 'authenticated' }, fn);
  }

  /**
   * Configuração dos totens, com os segredos **redigidos** (decisão B — ver
   * `totems.sql.ts`). O que sai é `<campo>_set: boolean`, nunca o valor.
   *
   * A licença vem junto por LATERAL: no browser era uma segunda consulta a
   * `billing.device_licenses` com o cruzamento e a regra de preferência em JavaScript.
   */
  async list(companyId: string, storeId: string | null): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(TOTEMS_SQL, [companyId, storeId]);
    return rows;
  }

  /** O totem é desta empresa? Porta de entrada de toda escrita de totem por RPC. */
  async pertenceAEmpresa(companyId: string, totemId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ ok: boolean }>(
      `select exists (select 1 from public.vw_devices_totem_config
                       where id = $1::uuid and company_id = $2::uuid) as ok`,
      [totemId, companyId],
    );
    return rows[0]?.ok === true;
  }

  /** Os três ambientes gravados no totem — o que a regra de licença julga na ativação. */
  async findAmbientes(companyId: string, totemId: string): Promise<ConfigParaRegra | undefined> {
    const { rows } = await this.db.query<ConfigParaRegra>(
      `select app_mode, payment_environment, nfce_environment
           from public.vw_devices_totem_config
          where id = $1::uuid and company_id = $2::uuid`,
      [totemId, companyId],
    );
    return rows[0];
  }

  /**
   * Chama `cloud_set_totem_active` como o usuário da sessão e devolve o jsonb dela.
   *
   * `select * from f()` numa função que retorna jsonb cria UMA coluna com o nome da
   * função — a resposta sairia embrulhada em `{ cloud_set_totem_active: {...} }`. O
   * alias desembrulha; sem ele a tela lê `undefined` em todo campo.
   */
  async setActiveViaRpc(
    userId: string,
    totemId: string,
    isActive: boolean,
    licenseId: string | null,
  ): Promise<unknown> {
    const rows = await this.comUsuario(userId, async (c) => {
      const r = await c.query<{ resultado?: unknown }>(
        `select public.cloud_set_totem_active(
             p_totem_id => $1::uuid,
             p_is_active => $2::boolean,
             p_license_id => $3::uuid) as resultado`,
        [totemId, isActive, licenseId],
      );
      return r.rows;
    });
    return rows[0]?.resultado;
  }

  /**
   * Chama `cloud_requeue_totem_sync` como o usuário da sessão.
   *
   * Mesmo alias da rota de ativação: sem ele a resposta sai embrulhada no nome da função
   * e a tela mostra "undefined licença(s) na outbox".
   */
  async requeueSyncViaRpc(userId: string, totemId: string): Promise<unknown> {
    const rows = await this.comUsuario(userId, async (c) => {
      const r = await c.query<{ resultado?: unknown }>(
        `select public.cloud_requeue_totem_sync(p_totem_id => $1::uuid) as resultado`,
        [totemId],
      );
      return r.rows;
    });
    return rows[0]?.resultado;
  }

  /** Insere o totem. `campos`/`valores` andam em par; o tenant ocupa `$1` e `$2`. */
  async insert(
    c: Queryable,
    companyId: string,
    storeId: string | null,
    campos: readonly string[],
    valores: readonly unknown[],
  ): Promise<string> {
    const placeholders = campos.map((_, i) => `$${i + 3}`);
    const { rows } = await c.query<{ id: string }>(
      `insert into public.vw_devices_totem_config (company_id, store_id, ${campos.join(', ')})
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
    totemId: string,
    campos: readonly string[],
    novosValores: Record<string, unknown>,
    quem: string,
  ): Promise<void> {
    await c.query(
      `insert into public.vw_devices_totem_config_audit
           (company_id, store_id, totem_config_id, action, changed_fields,
            previous_values, new_values, performed_by)
         values ($1::uuid, $2::uuid, $3::uuid, 'created', $4::text[], '{}'::jsonb, $5::jsonb, $6)`,
      [companyId, storeId, totemId, campos, JSON.stringify(novosValores), quem],
    );
  }

  /**
   * A configuração atual do totem em edição: os três ambientes, mais os campos que vão
   * ser alterados (para o diff da auditoria). `undefined` = não é desta empresa.
   */
  async findParaEdicao(
    c: Queryable,
    companyId: string,
    totemId: string,
    campos: readonly string[],
  ): Promise<TotemEmEdicao | undefined> {
    const { rows } = await c.query<TotemEmEdicao>(
      `select app_mode, payment_environment, nfce_environment${campos.length ? ', ' + campos.join(', ') : ''}
           from public.vw_devices_totem_config
          where id = $1::uuid and company_id = $2::uuid`,
      [totemId, companyId],
    );
    return rows[0];
  }

  /** Grava a edição. Devolve as linhas do `returning`: vazio = nada foi escrito. */
  async update(
    c: Queryable,
    companyId: string,
    totemId: string,
    campos: readonly string[],
    valores: readonly unknown[],
  ): Promise<Array<{ id: string }>> {
    const sets = campos.map((k, i) => `${k} = $${i + 3}`);
    const { rows } = await c.query<{ id: string }>(
      `update public.vw_devices_totem_config
            set ${sets.join(', ')}, updated_at = now()
          where id = $1::uuid and company_id = $2::uuid
          returning id`,
      [totemId, companyId, ...valores],
    );
    return rows;
  }

  async insertAuditUpdated(
    c: Queryable,
    companyId: string,
    totemId: string,
    campos: readonly string[],
    de: Record<string, unknown>,
    para: Record<string, unknown>,
    quem: string,
  ): Promise<void> {
    await c.query(
      `insert into public.vw_devices_totem_config_audit
             (company_id, totem_config_id, action, changed_fields,
              previous_values, new_values, performed_by)
           values ($1::uuid, $2::uuid, 'updated', $3::text[], $4::jsonb, $5::jsonb, $6)`,
      [companyId, totemId, campos, JSON.stringify(de), JSON.stringify(para), quem],
    );
  }
}
