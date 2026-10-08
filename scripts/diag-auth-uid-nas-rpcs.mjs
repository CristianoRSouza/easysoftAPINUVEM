/**
 * Diagnóstico — as RPCs de totem enxergam QUEM está chamando?
 *
 * Duas RPCs que a API já chama (`cloud_set_totem_active`, `cloud_requeue_totem_sync`) são
 * `SECURITY DEFINER` e autorizam por `auth.uid()` — a identidade que o Supabase injeta no
 * JWT. A API não usa JWT do Supabase: ela abre a conexão como o role `easyfood_api`. Se
 * `auth.uid()` vier nulo, a autorização de dentro da função nega e a rota quebra —
 * silenciosamente até alguém tentar ativar um totem.
 *
 * Este script só LÊ: chama `auth.uid()` e as duas funções de permissão. Não escreve nada,
 * não toca em totem nenhum, e não imprime credencial, host ou nome de empresa.
 *
 *   node scripts/diag-auth-uid-nas-rpcs.mjs
 */
import 'dotenv/config';
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('SUPABASE_DB_URL ausente no ambiente.');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });

try {
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

  const quem = await q(`select current_user as role_conectado`);
  console.log(`role conectado ......... ${quem.role_conectado}`);

  // auth.uid() lê request.jwt.claims. Sem JWT do Supabase, deve vir nulo.
  const uid = await q(`select auth.uid() is null as uid_nulo`);
  console.log(`auth.uid() é nulo? ..... ${uid.uid_nulo}`);

  // A pergunta que a RPC faz antes de deixar escrever. Com uid nulo, o esperado é false.
  const perm = await q(`
    select coalesce(public.is_system_admin(auth.uid()), false) as sysadmin,
           coalesce(public.has_company_access(auth.uid(),
             (select company_id from devices.totem_config limit 1)), false) as acesso_empresa`);
  console.log(`is_system_admin() ...... ${perm.sysadmin}`);
  console.log(`has_company_access() ... ${perm.acesso_empresa}`);

  const passaria = perm.sysadmin || perm.acesso_empresa;
  console.log('');
  console.log(
    passaria
      ? 'VEREDITO: a RPC autorizaria. As rotas de ativar/reenfileirar funcionam como estão.'
      : 'VEREDITO: a RPC NEGA (totem_access_denied). As rotas de ativar/reenfileirar' +
          ' precisam abrir a conexão com o contexto do usuário (withRls), senão quebram.',
  );
  process.exitCode = passaria ? 0 : 1;
} catch (e) {
  console.error(`falhou: ${e.code || ''} ${e.message}`);
  process.exitCode = 2;
} finally {
  await pool.end();
}
