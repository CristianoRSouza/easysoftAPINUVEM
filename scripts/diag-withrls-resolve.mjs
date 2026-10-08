/**
 * O `withRls` resolve o `auth.uid()` nulo das RPCs de totem?
 *
 * Continuação do `diag-auth-uid-nas-rpcs.mjs`, que provou que sem contexto a RPC nega.
 * Aqui a pergunta é se o remédio funciona: abrir a transação com
 * `set_config('role','authenticated')` + `request.jwt.claims` faz `auth.uid()` devolver o
 * usuário e a autorização de dentro da função passar.
 *
 * Duas coisas podem falhar e é importante distinguir:
 *   • trocar para `authenticated` pode ser negado por falta de membership no role;
 *   • trocando, a RLS passa a valer e os GRANTs que importam são os do `authenticated`,
 *     não os de `easyfood_api`.
 *
 * SÓ LÊ — abre transação e dá `rollback` no fim. Nenhuma escrita, nenhum totem tocado.
 * Não imprime credencial, host, nome de empresa nem id completo.
 *
 *   node scripts/diag-withrls-resolve.mjs
 */
import 'dotenv/config';
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('SUPABASE_DB_URL ausente no ambiente.');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();

try {
  // Um usuário real que tenha acesso a alguma empresa — só para ter um `sub` verdadeiro.
  const alvo = await c.query(`
    select cu.user_id, tc.company_id, tc.id as totem_id
      from devices.totem_config tc
      join public.pb_user_company_access cu on cu.company_id = tc.company_id
     limit 1`);

  if (alvo.rows.length === 0) {
    console.log('sem par usuário/totem para testar — inconclusivo.');
    process.exit(3);
  }
  const { user_id, company_id, totem_id } = alvo.rows[0];
  console.log(`usuário de teste ....... ${String(user_id).slice(0, 8)}…`);
  console.log(`totem de teste ......... ${String(totem_id).slice(0, 8)}… (nada será escrito)`);

  await c.query('begin');
  try {
    await c.query(
      "select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: user_id, role: 'authenticated' })],
    );
    console.log('troca para authenticated  OK');
  } catch (e) {
    console.log(`troca para authenticated  FALHOU: ${e.code} ${e.message}`);
    console.log('\nVEREDITO: o role da API não pode virar `authenticated`. Precisa de');
    console.log('`grant authenticated to easyfood_api;` — senão o withRls não é opção.');
    await c.query('rollback');
    process.exit(1);
  }

  const r = await c.query(
    `select auth.uid() is not null as tem_uid,
            coalesce(public.has_company_access(auth.uid(), $1::uuid), false) as acesso`,
    [company_id],
  );
  console.log(`auth.uid() preenchido? . ${r.rows[0].tem_uid}`);
  console.log(`has_company_access() ... ${r.rows[0].acesso}`);

  // A leitura que a RPC faz antes de decidir. Se a RLS esconder a linha, ela dá
  // `totem_not_found` em vez de `access_denied` — falha diferente, mesma rota quebrada.
  const v = await c.query(`select count(*)::int as n from devices.totem_config where id = $1::uuid`, [
    totem_id,
  ]);
  console.log(`totem visível sob RLS? . ${v.rows[0].n === 1}`);

  await c.query('rollback');

  const passa = r.rows[0].tem_uid && r.rows[0].acesso && v.rows[0].n === 1;
  console.log('');
  console.log(
    passa
      ? 'VEREDITO: withRls resolve. As rotas de totem devem rodar por ele.'
      : 'VEREDITO: withRls NÃO basta sozinho — ver qual das três linhas acima veio falsa.',
  );
  process.exitCode = passa ? 0 : 1;
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error(`falhou: ${e.code || ''} ${e.message}`);
  process.exitCode = 2;
} finally {
  c.release();
  await pool.end();
}
