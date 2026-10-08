import type { NfceListQuery } from '../../../contract/nfce.schema';

/** Filtros que a tela manda. `page`/`limit` não entram: quem pagina é cada consulta. */
export type FiltrosDeNota = Pick<
  NfceListQuery,
  'status' | 'reconcileStatus' | 'from' | 'to' | 'search'
>;

/**
 * O `where` da listagem, num lugar só.
 *
 * Existe porque a listagem e o download de XML PRECISAM enxergar exatamente o mesmo
 * conjunto: se o filtro divergir, a tela mostra "327 autorizadas" e o ZIP traz outro
 * número — e ninguém descobre até o contador reclamar. O `store_id` sempre em `$1` não é
 * estilo: o role desta API tem `BYPASSRLS` e é este filtro que faz o papel da RLS.
 */
export function filtrosDaLoja(storeId: string, q: FiltrosDeNota) {
  const where = ['n.store_id = $1::uuid'];
  const params: unknown[] = [storeId];
  const add = (v: unknown) => `$${params.push(v)}`;

  if (q.status && q.status !== 'all') where.push(`n.status = ${add(q.status)}`);
  if (q.reconcileStatus) where.push(`n.reconcile_status = ${add(q.reconcileStatus)}`);
  // Intervalo sobre a coluna crua, não `issued_at::date`: as mesmas notas, mas o índice
  // `(store_id, issued_at)` e o corte de partições (a tabela é particionada por
  // `issued_at`) só funcionam sem o cast na coluna.
  if (q.from) where.push(`n.issued_at >= ${add(q.from)}::date`);
  if (q.to) where.push(`n.issued_at < (${add(q.to)}::date + 1)`);

  if (q.search) {
    const term = q.search.trim();
    const like = add(`%${term.replace(/([%_\\])/g, '\\$1')}%`);
    // Número só entra na busca se o termo for numérico — senão o cast explodiria.
    const asNumber = /^\d+$/.test(term) ? add(Number(term)) : null;
    where.push(
      `(n.access_key ilike ${like} or n.authorization_protocol ilike ${like}` +
        (asNumber ? ` or n.number = ${asNumber}::int` : '') +
        `)`,
    );
  }

  return { where, params, add };
}
