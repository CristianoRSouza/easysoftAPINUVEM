import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import type { Row } from '../../../db/queryable';
import type { AttentionCountsRow, TotalsByStatusRow } from '../domain/nfce.mapper';
import { ISSUER_CONFIG_SQL } from './issuer-config.sql';
import { NFCE_DETAIL_SQL } from './nfce-detail.sql';
import { NFCE_ITEMS_SQL } from './nfce-items.sql';
import { filtrosDaLoja, type FiltrosDeNota } from './nfce-note-filter';

/**
 * A nota pertence à loja? Toda rota filha passa por aqui.
 *
 * Este `exists` é a diferença de segurança em relação ao browser: lá as consultas de
 * pagamentos/logs/eventos filtram só por `note_id` e quem barrava nota de outra loja era
 * a RLS. O role desta API tem BYPASSRLS, então sem esta amarra bastaria um `note_id`
 * alheio para ler o documento fiscal de outra empresa.
 */
const NOTE_BELONGS_TO_STORE = `
  exists (select 1 from public.vw_nfce_notes n
           where n.id = $1::uuid and n.store_id = $2::uuid)`;

/**
 * Leituras de NFC-e no Supabase: a nota, as tabelas filhas e a configuração fiscal da loja.
 * Toda consulta carrega o recorte de loja no próprio SQL — o role desta API tem `BYPASSRLS`.
 * As referências de XML (aba XML e ZIP do contador) ficam em `NfceXmlRepository`.
 */
/** Colunas da nota na listagem — as mesmas dentro e fora da CTE `pagina` (alias `n`). */
const NOTE_LIST_COLUMNS = `n.id, n.number, n.serie, n.access_key, n.status, n.total_value, n.issued_at,
              n.authorized_at, n.authorization_protocol, n.sefaz_status_code,
              n.sefaz_status_reason, n.emission_type, n.reconcile_status, n.retry_count`;

@Injectable()
export class NfceRepository {
  constructor(private readonly db: DbService) {}

  /**
   * Contadores dos cards de atenção — uma consulta, três `count(*) filter`.
   *
   * O browser usava `count: 'estimated'` (a estimativa do planner) por medo do full-scan
   * de três `count(*)` separados. Aqui é contagem EXATA e uma varredura só: o filtro por
   * `store_id` já reduz o conjunto, e card de "atenção" com número aproximado é o tipo de
   * coisa que faz o usuário perder a confiança no painel.
   */
  async countAttention(storeId: string): Promise<AttentionCountsRow | undefined> {
    const { rows } = await this.db.query<AttentionCountsRow>(
      `select
         count(*) filter (where status = 'manual_review')                    as manual_review,
         count(*) filter (where emission_type = 1
                            and reconcile_status = 'failed'
                            and coalesce(status, '') not in ('cancelled', 'inutilized')) as reconcile_failed,
         count(*) filter (where status = 'unusable')                         as unusable
       from public.vw_nfce_notes
      where store_id = $1::uuid`,
      [storeId],
    );
    return rows[0];
  }

  /**
   * Listagem. No browser eram três idas ao Supabase (notas, destinatários, pagamentos) e
   * o cruzamento em JavaScript por `Map`. Aqui é uma consulta com três laterais.
   *
   * `qtd_itens` conta só por `note_id` (o índice de itens começa por ele). Não amarrar
   * em `note_issued_at = n.issued_at`: se os dois divergirem, a contagem cai em silêncio.
   *
   * `total` é exato (`count(*) over()`), não a estimativa do planner que o browser usava:
   * paginação com total aproximado mostra "página 7 de 5".
   *
   * ── Por que a página é recortada ANTES dos laterais (CTE `pagina`) ─────────────
   * Com tudo numa consulta só, o `count(*) over()` obriga o Postgres a montar TODAS as
   * notas do filtro antes de aplicar o `limit` — e os três laterais rodavam para cada uma
   * delas, não só para as 50 da página. Medido em produção (08/10/2026) numa loja com
   * 1.303 notas: 32.575 idas às tabelas filhas para devolver 50 linhas, 41 ms; recortando
   * a página primeiro, 1.250 idas e 5 ms — e o custo deixa de crescer com o total de notas
   * da loja. O `materialized` é o que garante essa ordem: sem ele o planner pode fundir a
   * CTE de volta na consulta de fora. As linhas e a ordem são as mesmas.
   */
  async findNotes(storeId: string, q: FiltrosDeNota, limit: number, offset: number): Promise<Row[]> {
    const { where, params, add } = filtrosDaLoja(storeId, q);
    const { rows } = await this.db.query<Row>(
      `with pagina as materialized (
         select ${NOTE_LIST_COLUMNS},
                count(*) over() as total_count
           from public.vw_nfce_notes n
          where ${where.join(' and ')}
          order by n.issued_at desc nulls last, n.id desc
          limit ${add(limit)} offset ${add(offset)}
       )
       select ${NOTE_LIST_COLUMNS},
              r.cpf  as destinatario_cpf,
              r.name as destinatario_nome,
              pg.formas,
              it.qtd_itens,
              n.total_count
         from pagina n
         left join lateral (
           select cpf, name from public.vw_nfce_recipient where note_id = n.id limit 1
         ) r on true
         left join lateral (
           select string_agg(distinct payment_method, ', ' order by payment_method) as formas
             from public.vw_nfce_payments where note_id = n.id
         ) pg on true
         left join lateral (
           select count(*) as qtd_itens from public.vw_nfce_items where note_id = n.id
         ) it on true
        order by n.issued_at desc nulls last, n.id desc`,
      params,
    );
    return rows;
  }

  /**
   * Uma varredura só, agrupada por status: o `count` e o `sum` saem juntos, e os dois
   * enxergam exatamente o mesmo conjunto que a listagem (mesmo `filtrosDaLoja`).
   */
  async sumTotalsByStatus(storeId: string, q: FiltrosDeNota): Promise<TotalsByStatusRow[]> {
    const { where, params } = filtrosDaLoja(storeId, q);
    const { rows } = await this.db.query<TotalsByStatusRow>(
      `select lower(coalesce(n.status, 'draft')) as status,
              count(*)                          as qtd,
              coalesce(sum(n.total_value), 0)   as valor
         from public.vw_nfce_notes n
        where ${where.join(' and ')}
        group by 1`,
      params,
    );
    return rows;
  }

  /**
   * A nota e as 5 filhas numa consulta (no browser são seis chamadas paralelas juntadas
   * em JavaScript). Não devolve linha quando a nota não existe **ou** é de outra loja: o
   * filtro por `store_id` está na raiz da junção, então id alheio simplesmente não casa.
   */
  async findDetail(storeId: string, noteId: string): Promise<Row | undefined> {
    const { rows } = await this.db.query<Row>(NFCE_DETAIL_SQL, [noteId, storeId]);
    return rows[0];
  }

  /**
   * Itens da nota com os impostos. Ver `nfce-items.sql.ts`: a amarra de loja é **direta**
   * em cada JOIN, não derivada de uma consulta anterior — as views de imposto têm
   * `store_id`, então não precisamos confiar em ordem de execução.
   */
  async findItems(storeId: string, noteId: string): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(NFCE_ITEMS_SQL, [noteId, storeId]);
    return rows;
  }

  /** Loja + certificado ativo + chave de API. `ehAdmin` é o `$3` de `issuer-config.sql.ts`. */
  async findIssuerConfig(companyId: string, storeId: string, ehAdmin: boolean): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(ISSUER_CONFIG_SQL, [storeId, companyId, ehAdmin]);
    return rows;
  }

  /**
   * Parâmetros ACBr da loja (espelho de `nfce_acbr_config` do POS, via Sync-PG-SB). Só
   * leitura: quem altera é a loja. Tabela da migração 20260929230000 do EasyFoodManager-Web.
   */
  async findAcbrConfig(companyId: string, storeId: string): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select id, key, value, description, updated_at
         from nfce.acbr_config
        where company_id = $1::uuid and store_id = $2::uuid
        order by key`,
      [companyId, storeId],
    );
    return rows;
  }

  async findPayments(storeId: string, noteId: string): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select * from public.vw_nfce_payments
        where note_id = $1::uuid and ${NOTE_BELONGS_TO_STORE}
        order by payment_number`,
      [noteId, storeId],
    );
    return rows;
  }

  async findLogs(storeId: string, noteId: string): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select id, created_at, type, level, message, details, previous_status, new_status,
              return_code, protocol, user_name
         from public.vw_nfce_logs
        where note_id = $1::uuid and ${NOTE_BELONGS_TO_STORE}
        order by created_at desc`,
      [noteId, storeId],
    );
    return rows;
  }

  async findEvents(storeId: string, noteId: string): Promise<Row[]> {
    const { rows } = await this.db.query<Row>(
      `select id, event_type, event_description, event_sequence, event_at, justification,
              correction, protocol, sefaz_status_code, sefaz_status_reason, registered_at,
              situation, created_at
         from public.vw_nfce_events
        where note_id = $1::uuid and ${NOTE_BELONGS_TO_STORE}
        order by event_at desc`,
      [noteId, storeId],
    );
    return rows;
  }
}
