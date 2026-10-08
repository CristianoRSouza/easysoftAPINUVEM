/**
 * Cria os índices por tenant que faltam em `ecb_sync.inbox`.
 *
 * Contexto medido antes: a tabela tem ~3,8 milhões de linhas / 3.790 MB e NENHUM índice
 * começa por `(company_id, store_id)` — os que existem são a PK e três parciais com
 * `where apply_status = 'pending'`, que cobrem só a fatia pendente. O painel filtra por
 * empresa e loja sobre a tabela toda, então cada consulta virava varredura sequencial de
 * ~3,3 GB: 23 s para contar, 52 s para listar as 50 mais recentes.
 *
 * ── Por que CONCURRENTLY ──────────────────────────────────────────────────────
 * A fila está viva: o worker de sync escreve nela o tempo todo. `CREATE INDEX` comum
 * pega ShareLock e BLOQUEIA INSERT até terminar — numa tabela deste tamanho seriam
 * minutos de fila parada nas lojas. `CONCURRENTLY` faz duas passadas e não bloqueia
 * escrita; em troca, não pode rodar dentro de transação e pode terminar INVÁLIDO se
 * falhar no meio. Por isso o script confere a validade no fim e avisa.
 *
 *   node scripts/indices-sync-inbox.mjs            # cria e mede
 *   SO_MEDIR=1 node scripts/indices-sync-inbox.mjs # só mede, não cria nada
 *
 * Só toca em índices — nenhuma linha é lida, alterada ou apagada. Nenhuma credencial é
 * impressa.
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
const SO_MEDIR = process.env.SO_MEDIR === '1';

const INDICES = [
  {
    nome: 'inbox_tenant_status',
    serve: 'resumo, por entidade, falhas por erro, backlog',
    sql: `create index concurrently if not exists inbox_tenant_status
            on ecb_sync.inbox (company_id, store_id, apply_status, entity_name)
            include (retry_count, received_at)`,
  },
  {
    nome: 'inbox_tenant_recente',
    serve: 'movimento recente (top-50 sem ordenar 1,68 milhão de linhas)',
    // `desc nulls last` — e o `nulls last` NÃO é detalhe.
    //
    // A primeira versão deste índice foi criada só com `desc`, que no PostgreSQL significa
    // DESC NULLS FIRST. A RPC pede `desc nulls last`. Com a ordenação diferente, o
    // planejador usa o índice para FILTRAR mas ainda faz o sort: varre 1,68 milhão de
    // entradas e busca cada linha na tabela (272 mil leituras aleatórias). Resultado
    // medido: a rota foi de 22 s para 125 s — pior que a varredura sequencial que existia
    // antes, porque leitura aleatória é mais cara que sequencial.
    sql: `create index concurrently if not exists inbox_tenant_recente
            on ecb_sync.inbox (company_id, store_id, (coalesce(applied_at, received_at)) desc nulls last)`,
  },
  {
    nome: 'inbox_tenant_applied_at',
    serve: 'ritmo de aplicação dos últimos 60 minutos',
    sql: `create index concurrently if not exists inbox_tenant_applied_at
            on ecb_sync.inbox (company_id, store_id, applied_at)
            where apply_status = 'applied'`,
  },
];

const RPCS = [
  ['cloud_sync_inbox_summary', {}],
  ['cloud_sync_inbox_by_entity', {}],
  ['cloud_sync_inbox_failures_by_error', {}],
  ['cloud_sync_inbox_backlog', {}],
  ['cloud_sync_inbox_apply_rate', {}],
  ['cloud_sync_inbox_active_retries', { p_limit: 100 }],
  ['cloud_sync_inbox_recent_failures', { p_limit: 30 }],
  ['cloud_sync_inbox_recent_all', { p_limit: 50, p_offset: 0 }],
];

async function medir(pool) {
  const out = {};
  for (const [rpc, extra] of RPCS) {
    const args = { p_company_id: EMPRESA, p_store_id: LOJA, ...extra };
    const nomes = Object.keys(args);
    const t0 = Date.now();
    try {
      await pool.query(
        `select * from public.${rpc}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(', ')})`,
        Object.values(args),
      );
    } catch (e) {
      console.log(`  ! ${rpc}: ${String(e.message).slice(0, 60)}`);
    }
    out[rpc] = Date.now() - t0;
  }
  return out;
}

const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });

try {
  // Criar índice numa tabela de 3,8 GB passa de qualquer teto padrão.
  await pool.query('set statement_timeout = 0');
  // Se algo já estiver segurando lock pesado, é melhor falhar rápido que enfileirar.
  await pool.query("set lock_timeout = '30s'");

  let antes = null;
  if (EMPRESA && LOJA) {
    console.log('=== ANTES ===');
    antes = await medir(pool);
    for (const [k, v] of Object.entries(antes)) console.log(`  ${String(v).padStart(7)} ms  ${k}`);
  } else {
    console.log('(sem EMPRESA/LOJA no ambiente — pulando a medição)');
  }

  if (!SO_MEDIR) {
    console.log('\n=== CRIANDO ÍNDICES (sem bloquear escrita) ===');
    for (const ix of INDICES) {
      const t0 = Date.now();
      process.stdout.write(`  ${ix.nome} … `);
      try {
        await pool.query(ix.sql);
        console.log(`pronto em ${((Date.now() - t0) / 1000).toFixed(0)}s — serve ${ix.serve}`);
      } catch (e) {
        console.log(`FALHOU: ${String(e.message).slice(0, 120)}`);
      }
    }

    // CONCURRENTLY que falha no meio deixa índice INVÁLIDO, que o planejador ignora em
    // silêncio — daria "criei tudo" com a tela ainda lenta.
    const { rows: ruins } = await pool.query(`
      select c.relname
        from pg_index i
        join pg_class c on c.oid = i.indexrelid
        join pg_class t on t.oid = i.indrelid
        join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = 'ecb_sync' and t.relname = 'inbox' and not i.indisvalid`);
    if (ruins.length) {
      console.log('\n⚠️  ÍNDICES INVÁLIDOS (precisam de DROP + recriar): ' + ruins.map((r) => r.relname).join(', '));
    }

    const { rows: tam } = await pool.query(`
      select c.relname as nome, pg_size_pretty(pg_relation_size(c.oid)) as tamanho
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'ecb_sync' and c.relname = any($1::text[]) order by c.relname`,
      [INDICES.map((i) => i.nome)]);
    console.log('\ntamanho em disco:');
    for (const r of tam) console.log(`  ${r.nome.padEnd(26)} ${r.tamanho}`);
  }

  if (antes) {
    console.log('\n=== DEPOIS ===');
    const depois = await medir(pool);
    console.log('   antes    depois   ganho   rota');
    for (const k of Object.keys(antes)) {
      const a = antes[k], d = depois[k];
      const ganho = d > 0 ? (a / d).toFixed(0) + 'x' : '—';
      console.log(`${String(a).padStart(8)} ${String(d).padStart(9)} ms ${ganho.padStart(7)}   ${k}`);
    }
  }
} finally {
  await pool.end();
}
