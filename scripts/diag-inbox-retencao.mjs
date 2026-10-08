/**
 * Diagnóstico — o que uma política de retenção na `ecb_sync.inbox` apagaria, e o que
 * deixaria de existir junto.
 *
 * A pergunta não é só "quanto encolhe". A inbox é também o LIVRO-CAIXA de idempotência:
 * a chave primária é o `event_id`, e o `on conflict (event_id) do nothing` é o que impede
 * um evento reentregue de ser aplicado duas vezes. Apagar linhas aplicadas tira essa trava
 * para aqueles eventos — então convém saber quanto isso pesa antes de escolher o prazo.
 *
 *   node scripts/diag-inbox-retencao.mjs
 *
 * Só LÊ. Nada é apagado por este script.
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
  console.log('=== COMPOSIÇÃO DA FILA ===');
  const { rows: comp } = await pool.query(`
    select apply_status,
           count(*)                                          as qtd,
           to_char(min(received_at), 'DD/MM/YYYY')           as mais_antigo,
           to_char(max(received_at), 'DD/MM/YYYY')           as mais_recente
      from ecb_sync.inbox
     group by apply_status
     order by count(*) desc`);
  for (const r of comp) {
    console.log(`  ${String(r.apply_status).padEnd(10)} ${String(r.qtd).padStart(9)}  de ${r.mais_antigo} a ${r.mais_recente}`);
  }

  console.log('\n=== QUANTO CADA PRAZO APAGARIA (só os `applied`) ===');
  for (const dias of [7, 15, 30, 60, 90, 180]) {
    const { rows } = await pool.query(
      `select count(*) as apaga,
              (select count(*) from ecb_sync.inbox) - count(*) as sobra
         from ecb_sync.inbox
        where apply_status = 'applied'
          and coalesce(applied_at, received_at) < now() - ($1 || ' days')::interval`,
      [String(dias)],
    );
    const r = rows[0];
    const pc = Math.round((Number(r.apaga) / (Number(r.apaga) + Number(r.sobra))) * 100);
    console.log(`  guardar ${String(dias).padStart(3)} dias  ->  apaga ${String(r.apaga).padStart(9)} (${String(pc).padStart(2)}%)   sobram ${String(r.sobra).padStart(9)}`);
  }

  console.log('\n=== O EVENTO MAIS ANTIGO AINDA PENDENTE OU EM FALHA ===');
  const { rows: presos } = await pool.query(`
    select apply_status,
           to_char(min(received_at), 'DD/MM/YYYY HH24:MI') as mais_antigo,
           count(*) as qtd
      from ecb_sync.inbox
     where apply_status <> 'applied'
     group by apply_status`);
  if (!presos.length) console.log('  nenhum — tudo aplicado');
  for (const r of presos) console.log(`  ${r.apply_status}: ${r.qtd} (mais antigo: ${r.mais_antigo})`);

  console.log('\n=== JÁ EXISTE ALGUMA LIMPEZA AUTOMÁTICA? ===');
  const { rows: ext } = await pool.query(
    `select extname, extversion from pg_extension where extname in ('pg_cron','pg_partman')`);
  console.log('  extensões:', ext.length ? ext.map((e) => `${e.extname} ${e.extversion}`).join(', ') : 'nenhuma (nem pg_cron, nem pg_partman)');

  const { rows: cron } = await pool.query(`
    select count(*) as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'cron' and c.relname = 'job'`);
  if (Number(cron[0].n) > 0) {
    const { rows: jobs } = await pool.query(`select jobname, schedule, active from cron.job order by jobname`);
    console.log('  tarefas agendadas:', jobs.length);
    for (const j of jobs) console.log(`    ${j.active ? 'ativa ' : 'parada'} ${String(j.schedule).padEnd(14)} ${j.jobname}`);
  } else {
    console.log('  tarefas agendadas: não há tabela cron.job (pg_cron não instalado)');
  }

  // A tabela é particionada? Se fosse, o expurgo seria DROP de partição — instantâneo e
  // sem inchar a tabela, ao contrário de DELETE.
  const { rows: part } = await pool.query(`
    select c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'ecb_sync' and c.relname = 'inbox'`);
  console.log('  a inbox é particionada?', part[0]?.relkind === 'p' ? 'SIM' : 'não (tabela comum)');

  console.log('\n=== ESPAÇO ===');
  const { rows: tam } = await pool.query(`
    select pg_size_pretty(pg_relation_size('ecb_sync.inbox'))       as dados,
           pg_size_pretty(pg_indexes_size('ecb_sync.inbox'))        as indices,
           pg_size_pretty(pg_total_relation_size('ecb_sync.inbox')) as total`);
  console.log(`  dados ${tam[0].dados} + índices ${tam[0].indices} = ${tam[0].total}`);
} finally {
  await pool.end();
}
