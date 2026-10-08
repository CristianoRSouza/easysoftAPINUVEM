/**
 * Diagnóstico — por que o Monitor de Sincronização demora a abrir?
 *
 * Medido no navegador: a aba Inbox leva ~67s, e quatro das oito chamadas passam de 57s
 * cada. As rotas da API só repassam as RPCs `cloud_sync_*`, então o tempo está no banco.
 *
 * Aqui cada RPC é cronometrada direto no PostgreSQL, para a mesma loja da tela, e ao lado
 * ficam o tamanho das tabelas e os índices existentes. Assim dá para separar "consulta mal
 * escrita" de "falta índice" de "tabela grande demais para agregar ao vivo".
 *
 *   LOJA=<uuid> EMPRESA=<uuid> node scripts/diag-sync-panel-lento.mjs
 *
 * Só LÊ. Nenhuma credencial é impressa; os UUIDs vêm por ambiente.
 */
import 'dotenv/config';
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('SUPABASE_DB_URL ausente no ambiente.');
  process.exit(2);
}
const EMPRESA = process.env.EMPRESA;
const LOJA = process.env.LOJA;
if (!EMPRESA || !LOJA) {
  console.error('Defina EMPRESA e LOJA (uuid) no ambiente.');
  process.exit(2);
}

const RPCS = [
  // inbox
  ['cloud_sync_inbox_summary', {}],
  ['cloud_sync_inbox_by_entity', {}],
  ['cloud_sync_inbox_failures_by_error', {}],
  ['cloud_sync_inbox_backlog', {}],
  ['cloud_sync_inbox_apply_rate', {}],
  ['cloud_sync_inbox_active_retries', { p_limit: 100 }],
  ['cloud_sync_inbox_recent_failures', { p_limit: 30 }],
  ['cloud_sync_inbox_recent_all', { p_limit: 50, p_offset: 0 }],
  // outbox
  ['cloud_sync_outbox_summary', {}],
  ['cloud_sync_outbox_by_entity', {}],
  ['cloud_sync_outbox_failures_by_error', {}],
  ['cloud_sync_outbox_backlog', {}],
  ['cloud_sync_outbox_dispatch_rate', {}],
  ['cloud_sync_outbox_active_retries', { p_limit: 50 }],
  ['cloud_sync_outbox_recent_failures', { p_limit: 50 }],
  ['cloud_sync_outbox_recent_all', { p_limit: 50, p_offset: 0 }],
];

const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });

try {
  console.log('=== TAMANHO DAS FILAS ===');
  const { rows: tam } = await pool.query(`
    select c.relname                                as tabela,
           to_char(c.reltuples::bigint, 'FM999G999G999') as linhas_estimadas,
           pg_size_pretty(pg_total_relation_size(c.oid)) as tamanho
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'ecb_sync' and c.relkind = 'r'
     order by c.relname`);
  for (const r of tam) console.log(`  ${r.tabela.padEnd(12)} ~${String(r.linhas_estimadas).padStart(12)} linhas   ${r.tamanho}`);

  console.log('\n=== ÍNDICES ===');
  const { rows: idx } = await pool.query(`
    select tablename, indexname, indexdef
      from pg_indexes where schemaname = 'ecb_sync' order by tablename, indexname`);
  for (const r of idx) {
    const cols = r.indexdef.slice(r.indexdef.indexOf('('));
    console.log(`  ${r.tablename.padEnd(8)} ${r.indexname.padEnd(42)} ${cols.slice(0, 90)}`);
  }

  console.log('\n=== TEMPO DE CADA RPC (para a loja da tela) ===');
  const lentas = [];
  for (const [rpc, extra] of RPCS) {
    const args = { p_company_id: EMPRESA, p_store_id: LOJA, ...extra };
    const nomes = Object.keys(args);
    const chamada = `select * from public.${rpc}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
    const t0 = Date.now();
    let n = 0;
    let erro = '';
    try {
      const r = await pool.query(chamada, Object.values(args));
      n = r.rows.length;
    } catch (e) {
      erro = String(e.message).slice(0, 70);
    }
    const ms = Date.now() - t0;
    if (ms > 2000) lentas.push(rpc);
    console.log(`  ${String(ms).padStart(7)} ms  ${String(n).padStart(4)} linhas  ${rpc}${erro ? '  ERRO: ' + erro : ''}`);
  }

  if (lentas.length) {
    console.log('\n=== O QUE AS LENTAS FAZEM (definição resumida) ===');
    for (const rpc of lentas.slice(0, 4)) {
      const { rows } = await pool.query(
        `select pg_get_functiondef(p.oid) as def
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1 limit 1`,
        [rpc],
      );
      const def = rows[0]?.def ?? '';
      const corpo = def.slice(def.indexOf('$function$') + 10, def.lastIndexOf('$function$'));
      console.log(`\n--- ${rpc} ---`);
      console.log(corpo.split('\n').filter((l) => l.trim()).slice(0, 22).join('\n'));
    }
  }
} finally {
  await pool.end();
}
