import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, types, type QueryResultRow } from 'pg';
import { ENV, type Env } from '../config/env';
import type { Row } from './queryable';

// Gotcha EasyML §4: o driver pg cru diverge do PostgREST nos tipos. Restauramos o
// contrato de fio uma vez, no módulo do pool, para o front/clientes não quebrarem:
//   int8 e numeric -> string ; date -> 'YYYY-MM-DD' (sem deslocar o fuso).
types.setTypeParser(20, (v) => v); // int8
types.setTypeParser(1700, (v) => v); // numeric
types.setTypeParser(1082, (v) => v); // date

/**
 * Único ponto que fala com o Postgres. Expõe `query` e o padrão `withRls`
 * (preparado para as rotas de tenant — não usado pela rota máquina-a-máquina).
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly log = new Logger(DbService.name);
  private readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    // TLS: se houver CA, valida contra ele (verify-full). Sem CA, respeita o flag
    // (default true = fail-closed; o operador escolhe conscientemente relaxar).
    const ca = env.DATABASE_CA_CERT.trim();
    const ssl = ca
      ? { ca, rejectUnauthorized: true }
      : { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED };
    // Status VISÍVEL no boot: em produção você confirma pelo log se a identidade do
    // banco está sendo verificada (fecha "homem no meio") ou apenas criptografada.
    if (ca) {
      this.log.log('TLS do banco: verificação de certificado LIGADA (CA fornecido via DATABASE_CA_CERT).');
    } else if (env.DATABASE_SSL_REJECT_UNAUTHORIZED) {
      this.log.log('TLS do banco: verificação LIGADA pelo CA do sistema (sem DATABASE_CA_CERT).');
    } else {
      const msg =
        'TLS do banco: verificação DESLIGADA (DATABASE_SSL_REJECT_UNAUTHORIZED=false) — criptografado, mas SEM conferir a identidade do servidor. Aceitável só fora de produção.';
      if (env.NODE_ENV === 'production') this.log.error(`⚠ ${msg}`);
      else this.log.warn(msg);
    }
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      /*
       * ► POR QUE 5 MINUTOS, E NÃO 30 SEGUNDOS
       *
       *   Abrir conexão com o Supabase custa caro: TCP + TLS + autenticação sobre a
       *   internet. Medido nesta instalação: 337ms na primeira, ~126ms nas seguintes,
       *   contra 13-15ms de uma query em conexão já aberta. O tempo de conexão é uma
       *   ordem de grandeza maior que o trabalho em si.
       *
       *   Com 30s, um painel administrativo — onde se clica, se lê, se pensa — voltava
       *   a pagar esse custo a cada pausa. E o polling de 60s do dashboard caía
       *   exatamente no pior ponto: sempre DEPOIS do timeout, nunca mantendo a conexão
       *   viva, só pagando reconexão a cada ciclo.
       *
       *   5 minutos cobrem a pausa típica sem segurar conexão ociosa por tempo demais.
       *   O `max: 10` continua limitando o total.
       */
      idleTimeoutMillis: 5 * 60_000,
      connectionTimeoutMillis: 8_000,
      /*
       * Teto por query, aplicado pelo servidor. Sem isto, uma consulta travada (lock,
       * plano ruim depois do banco crescer) segura uma das 10 conexões até alguém
       * perceber; com poucas assim, o pool esgota e a API inteira para de responder —
       * uma query lenta vira indisponibilidade geral. 15s é folgado para o que estas
       * rotas fazem e ainda corta o caso patológico.
       */
      statement_timeout: 15_000,
      ssl,
    });
    this.pool.on('error', (e) => this.log.error(`pool error: ${e.message}`));
  }

  /**
   * Sem genérico, a linha é `Row` (colunas `unknown`): quem lê decide o tipo. Passe o tipo
   * da linha — `query<MinhaLinha>(...)` — em vez de confiar num `any` implícito.
   */
  query<T extends QueryResultRow = Row>(text: string, params?: unknown[]) {
    return this.pool.query<T>(text, params);
  }

  /**
   * Roda `fn` dentro de UMA transação (BEGIN/COMMIT; ROLLBACK em erro) — o que dá
   * atomicidade "tudo-ou-nada" a uma sequência de escritas feita na camada de
   * aplicação (substitui a atomicidade que antes vinha da RPC no banco).
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Transação com a IDENTIDADE do usuário (`request.jwt.claims`), SEM trocar de papel.
   *
   * Para chamar RPC `SECURITY DEFINER` que autoriza por `auth.uid()`: dentro dela quem
   * decide é o `auth.uid()`, que lê só os claims — o papel da conexão não entra. Já a
   * permissão de EXECUTE é conferida com o papel de QUEM CHAMA, e é aí que o `withRls`
   * quebra: ele troca para `authenticated`, e desde 07/08/2026 (EasyERP-Web-API,
   * `revogar_grants_frouxos_de_anon_e_authenticated`) o `authenticated` não executa
   * `cloud_set_totem_active` — `permission denied`, ativar totem pela nuvem morria em
   * homologação E em produção. O papel da API (`easyfood_api`) tem o EXECUTE.
   */
  async withClaims<T>(
    claims: Record<string, unknown>,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // Local à transação (terceiro argumento true) e parametrizado: claims nunca toca a SQL.
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Padrão withRls (EasyML §4) — abre transação com o contexto de tenant e roda
   * as queries sob RLS. Preparado; a rota de provisionamento (máquina-a-máquina)
   * NÃO usa isto (roda pelo chokepoint de service_role).
   */
  async withRls<T>(
    claims: Record<string, unknown>,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // Os dois set_config num statement só (1 round-trip). Parametrizado: claims nunca toca a SQL.
      await client.query(
        "select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)",
        [JSON.stringify(claims)],
      );
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end().catch(() => undefined);
  }
}
