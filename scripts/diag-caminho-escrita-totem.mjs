/**
 * A corrente da escrita de totem, sob o role REAL da API — sem escrever nada.
 *
 * Os diagnósticos anteriores rodaram como `postgres` e perguntaram "eu consigo?" — o que
 * prova pouco: `postgres` passaria mesmo com os grants todos errados. Aqui a pergunta é
 * sempre sobre o `easyfood_api`, então cada resposta vale para o que a API encontra.
 *
 * ⚠️ Encarnar o role NÃO é possível: no Supabase o `postgres` não é superusuário nem
 * membro de `easyfood_api`, e `set role easyfood_api` é negado (42501). Por isso os
 * privilégios são consultados pelas funções de 3 argumentos
 * (`has_table_privilege('easyfood_api', ...)`), que respondem o mesmo sem trocar de role.
 * A metade do `authenticated` roda de verdade, porque desse o `postgres` é membro.
 *
 * O que é verificado, na ordem em que a rota faz:
 *   1. easyfood_api enxerga a view de totem e a auditoria (e pode gravar nelas)
 *   2. easyfood_api LÊ billing.device_licenses (a regra de licença) — e só lê
 *   3. easyfood_api consegue TROCAR para authenticated (o withRls)
 *   4. já como authenticated, auth.uid() resolve e has_company_access() passa
 *   5. o totem continua visível sob RLS (senão a RPC dá totem_not_found)
 *   6. há privilégio de EXECUTE nas duas RPCs
 *
 * Tudo dentro de uma transação com `rollback` no fim. Nenhuma linha criada, alterada ou
 * apagada. Não imprime credencial, host, nome de empresa nem id completo.
 *
 *   node scripts/diag-caminho-escrita-totem.mjs
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

let falhas = 0;
const ok = (nome, cond, detalhe = '') => {
  console.log(`${cond ? 'ok   ' : 'FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!cond) falhas++;
};

try {
  // Um par usuário/totem verdadeiro, obtido ANTES de baixar o privilégio.
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
  console.log(`totem de teste ......... ${String(totem_id).slice(0, 8)}… (nada será escrito)\n`);

  await c.query('begin');

  // NAO da para virar easyfood_api: no Supabase o `postgres` nao e superusuario nem
  // membro dele. Entao em vez de ENCARNAR o role, perguntamos SOBRE ele — as funcoes de
  // privilegio de 3 argumentos respondem exatamente o que ele podera fazer.
  const priv = await c.query(`
    select has_table_privilege('easyfood_api','public.vw_devices_totem_config','select') as sel_cfg,
           has_table_privilege('easyfood_api','public.vw_devices_totem_config','insert') as ins_cfg,
           has_table_privilege('easyfood_api','public.vw_devices_totem_config','update') as upd_cfg,
           has_table_privilege('easyfood_api','public.vw_devices_totem_config_audit','insert') as ins_aud,
           has_table_privilege('easyfood_api','billing.device_licenses','select') as sel_lic,
           has_table_privilege('easyfood_api','billing.device_licenses','update') as upd_lic,
           has_table_privilege('easyfood_api','billing.device_licenses','insert') as ins_lic,
           has_schema_privilege('easyfood_api','billing','usage') as usa_billing,
           has_function_privilege('easyfood_api','public.cloud_set_totem_active(uuid,boolean,uuid)','execute') as ativar,
           has_function_privilege('easyfood_api','public.cloud_requeue_totem_sync(uuid)','execute') as requeue,
           pg_has_role('easyfood_api','authenticated','member') as vira_authenticated`);
  const p0 = priv.rows[0];

  ok('le a view de totem', p0.sel_cfg);
  ok('pode inserir totem', p0.ins_cfg);
  ok('pode editar totem', p0.upd_cfg);
  ok('pode gravar auditoria', p0.ins_aud);
  ok('usa o schema billing', p0.usa_billing);
  ok('le billing.device_licenses', p0.sel_lic);
  // As duas seguintes TEM de vir falsas: escrever em billing e do produto de billing.
  ok('NAO pode dar update em billing', p0.upd_lic === false, 'esperado: sem update');
  ok('NAO pode inserir em billing', p0.ins_lic === false, 'esperado: sem insert');
  ok('pode executar cloud_set_totem_active', p0.ativar);
  ok('pode executar cloud_requeue_totem_sync', p0.requeue);
  // Precondicao exata do SET ROLE que o withRls faz.
  ok('easyfood_api pode virar authenticated', p0.vira_authenticated);

  // Esta metade roda de verdade: o `postgres` E membro de authenticated. Prova que,
  // uma vez como authenticated, a identidade resolve e a RLS deixa o totem visivel.
  let trocou = true;
  try {
    await c.query(
      "select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: user_id, role: 'authenticated' })],
    );
  } catch (e) {
    trocou = false;
    console.log(`      (erro na troca: ${e.code} ${e.message})`);
  }
  ok('a troca para authenticated funciona', trocou);

  if (trocou) {
    const r = await c.query(
      `select current_user as u,
              auth.uid() is not null as tem_uid,
              coalesce(public.has_company_access(auth.uid(), $1::uuid), false) as acesso,
              (select count(*) from devices.totem_config where id = $2::uuid) as visivel`,
      [company_id, totem_id],
    );
    ok('agora é authenticated', r.rows[0].u === 'authenticated', r.rows[0].u);
    ok('auth.uid() resolve', r.rows[0].tem_uid);
    ok('has_company_access() passa', r.rows[0].acesso);
    // Se a RLS escondesse a linha, a RPC daria totem_not_found em vez de funcionar.
    ok('o totem continua visível sob RLS', Number(r.rows[0].visivel) === 1);
  }

  await c.query('rollback');

  console.log('');
  console.log(
    falhas === 0
      ? 'VEREDITO: a corrente da escrita de totem está inteira sob o role real.'
      : `VEREDITO: ${falhas} elo(s) faltando — as rotas de totem ainda quebram.`,
  );
  process.exitCode = falhas === 0 ? 0 : 1;
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error(`falhou: ${e.code || ''} ${e.message}`);
  process.exitCode = 2;
} finally {
  c.release();
  await pool.end();
}
