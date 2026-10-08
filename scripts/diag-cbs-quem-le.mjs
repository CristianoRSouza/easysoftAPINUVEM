/**
 * Diagnóstico — por que 4 seções da Reforma Tributária vêm vazias no Manager novo?
 *
 * Sintoma: com o MESMO código (caminho Supabase), o Manager antigo mostra 13 regras de
 * crédito presumido e o novo mostra "nenhuma encontrada". Zero erro de rede nos dois: o
 * PostgREST responde 200 com lista vazia. Isso é a assinatura de RLS filtrando, não de
 * rota quebrada.
 *
 * A diferença entre os dois: o Manager antigo tem sessão do Supabase (role `authenticated`),
 * o novo não tem nenhuma — em modo API a sessão é um cookie da EasyFoodAPI, e o cliente do
 * Supabase que sobrou fala como `anon`.
 *
 * Este script só LÊ o catálogo: quais políticas de RLS existem em cada tabela de CBS e a
 * quais roles elas se aplicam. Nada de dado de cliente, nada de credencial impressa.
 *
 *   node scripts/diag-cbs-quem-le.mjs
 */
import 'dotenv/config';
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('SUPABASE_DB_URL ausente no ambiente.');
  process.exit(2);
}

const TABELAS = [
  // as que aparecem no Manager novo
  'pb_cbs_union_rates',
  'pb_cbs_state_rates',
  'pb_cbs_fund_legais',
  'pb_cbs_cclasstrib_dfe_types',
  'pb_cbs_cclasstrib_ind',
  'pb_cbs_cst_ind',
  'pb_cbs_cclasstrib',
  // as que vem VAZIAS no Manager novo
  'pb_cbs_ccredpres',
  'pb_cbs_cst',
  'pb_cbs_is_ncm',
  'pb_cbs_cclasstrib_is',
  'pb_cbs_cst_is',
];

const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });

try {
  const { rows } = await pool.query(
    `select n.nspname || '.' || c.relname             as tabela,
            c.relrowsecurity                         as rls_ligada,
            coalesce(
              (select array_agg(distinct g.grantee::text order by g.grantee::text)
                 from information_schema.role_table_grants g
                where g.table_schema = n.nspname
                  and g.table_name   = c.relname
                  and g.privilege_type = 'SELECT'
                  and g.grantee in ('anon','authenticated')), '{}') as quem_tem_select,
            coalesce(
              (select array_agg(p.polname || ' -> ' ||
                       coalesce((select string_agg(r.rolname, '+' order by r.rolname)
                                   from pg_roles r where r.oid = any(p.polroles)), 'PUBLIC'))
                 from pg_policy p where p.polrelid = c.oid), '{}')  as politicas
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where c.relname = any($1::text[]) and n.nspname not in ('pg_catalog','information_schema')
      order by c.relname`,
    [TABELAS],
  );

  const VAZIAS = new Set(['public.pb_cbs_ccredpres', 'public.pb_cbs_cst', 'public.pb_cbs_is_ncm']);
  console.log('marca  tabela                            RLS   SELECT p/            políticas');
  console.log('-'.repeat(110));
  for (const r of rows) {
    const marca = VAZIAS.has(r.tabela) ? 'VAZIA' : '  ok ';
    console.log(
      `${marca}  ${r.tabela.padEnd(34)} ${String(r.rls_ligada).padEnd(5)} ` +
        `${(r.quem_tem_select.join(',') || '(ninguém)').padEnd(21)} ${r.politicas.join(' | ') || '(nenhuma)'}`,
    );
  }
  // `r.tabela` vem qualificado (`public.x`) e `TABELAS` não — comparar cru dizia que TODAS
  // faltavam, contradizendo as linhas logo acima.
  const faltando = TABELAS.filter((t) => !rows.some((r) => r.tabela.split('.')[1] === t));
  if (faltando.length) console.log('\nnão existem no banco: ' + faltando.join(', '));

  console.log(
    '\nCOMO LER: "-> PUBLIC" = o role `anon` lê a tabela. "-> authenticated" = só lê quem\n' +
      'tem sessão do Supabase. O Manager em modo API NÃO tem sessão do Supabase (a sessão\n' +
      'dele é o cookie da EasyFoodAPI), então ele lê como `anon` — e nas três marcadas\n' +
      'VAZIA o PostgREST devolve 200 com lista vazia. É por isso que aquelas seções aparecem\n' +
      'em branco no Manager novo e cheias no antigo, com o mesmo código dos dois lados.',
  );
} finally {
  await pool.end();
}
