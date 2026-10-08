import type { Queryable } from '../../db/queryable';

/**
 * "Esta pessoa pode administrar esta loja?" — UMA definição, usada por todos.
 *
 * ── Por que existe ────────────────────────────────────────────────────────────
 * A pergunta estava respondida em quatro lugares, e três respondiam ERRADO. Todos
 * chamavam `public.is_company_admin_for_store` sozinha, que exige linha em
 * `pb_user_company_access`. Um `system_admin` **não tem nenhuma** — ele enxerga tudo por
 * PAPEL, não por concessão. Resultado: quem administra o sistema levava 403 em
 *
 *   • toda tela que precisa de loja (o `TenantGuard`);
 *   • gerar código de primeiro acesso;
 *   • cifrar segredos TEF.
 *
 * O primeiro caso custou uma sessão inteira de depuração, porque o sintoma mentia: a API
 * LISTAVA a loja e depois negava a mesma loja dizendo "sem acesso".
 *
 * Com a regra num lugar só, um quinto ponto de uso não tem como divergir — e se a regra
 * mudar, muda para todos de uma vez.
 *
 * ── A regra ───────────────────────────────────────────────────────────────────
 * Pode administrar quem for:
 *   • `system_admin` / `tech_admin` — por papel, alcança qualquer loja;
 *   • admin da empresa dona da loja — por concessão, o caminho de sempre.
 *
 * Note que NÃO basta ter acesso à loja (`pb_user_store_access`): isso deixa a pessoa
 * *usar* a loja, não *administrá-la*. Gerar código de acesso e cifrar segredo TEF são
 * atos de administração, e é de propósito que exijam mais.
 */

/** O `$1` é o usuário e o `$2` a loja. Devolve uma coluna booleana `ok`. */
export const PODE_ADMINISTRAR_LOJA_SQL = `
  select (
    exists (
      select 1 from public.pv_user_roles ur
       where ur.user_id = $1::uuid
         and ur.role::text in ('system_admin', 'tech_admin')
    )
    or public.is_company_admin_for_store($1::uuid, $2::uuid)
  ) as ok`;

export async function podeAdministrarLoja(
  db: Queryable,
  userId: string,
  storeId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(PODE_ADMINISTRAR_LOJA_SQL, [userId, storeId]);
  return rows[0]?.ok === true;
}
