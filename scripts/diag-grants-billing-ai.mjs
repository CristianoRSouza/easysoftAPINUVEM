/**
 * Prova os GRANTs de /billing e /ai SOB O ROLE `easyfood_api`, sem escrever nada.
 *
 * ── A armadilha que este script existe para não repetir ───────────────────────
 * A primeira versão perguntava `has_table_privilege(tabela, priv)` — forma de DOIS
 * argumentos, que responde pelo `current_user`. Rodando com um `.env` que conecta
 * como `postgres`, deu tudo verde sem provar nada: o superusuário passa em qualquer
 * teste de privilégio. Um diagnóstico que aprova o que não testou é pior que nenhum.
 *
 * Agora a pergunta é explícita: privilégio DO ROLE `easyfood_api`, pelo nome (forma
 * de três argumentos), independente de quem conectou. E, quando dá, o `set role`
 * confirma que a leitura RESOLVE de verdade sob aquele role — privilégio concedido
 * numa view que não resolve a tabela base passa no teste de metadado e falha no uso.
 *
 * NENHUM insert é executado. Este banco pode ser PRODUÇÃO.
 *
 * USO:  node scripts/diag-grants-billing-ai.mjs
 */
import 'dotenv/config';
import { Pool } from 'pg';

const ROLE = 'easyfood_api';

const ca = (process.env.DATABASE_CA_CERT || '').trim();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ca
    ? { ca, rejectUnauthorized: true }
    : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' },
  max: 2,
});

/** [tabela, privilégios esperados, faz select de prova?] */
const ALVOS = [
  ['billing.credit_transactions', ['SELECT'], true],
  ['billing.usage_log', ['SELECT'], true],
  ['billing.usage_log_enriched', ['SELECT'], true],
  ['billing.company_licenses', ['SELECT'], true],
  ['billing.module_plans', ['SELECT'], true],
  ['billing.ai_chat_sessions', ['SELECT', 'INSERT', 'UPDATE', 'DELETE'], true],
];

/**
 * Privilégios que o role NÃO pode ter — e por quê.
 *
 * Esta lista é tão importante quanto a de cima. A API já escreveu medição de IA aqui, quando
 * implementava o assistente por conta própria; depois do ADR-0003 quem mede e cobra é o
 * EasyBilling, e um INSERT sobrevivente deixaria a porta encostada para a cobrança voltar a ser
 * duplicada — em silêncio, cobrando o mesmo cliente duas vezes.
 */
const PROIBIDOS = [
  ['billing.usage_log', 'INSERT', 'quem registra uso de IA é o EasyBilling'],
  ['billing.credit_transactions', 'INSERT', 'quem debita crédito é o EasyBilling'],
  ['billing.ai_kb_topics', 'SELECT', 'quem lê a base de conhecimento é o EasyBilling'],
  ['public.activity_logs', 'INSERT', 'a trilha do chat é escrita pelo EasyBilling'],
];

let falhas = 0;
const ok = (nome, cond, detalhe = '') => {
  if (!cond) falhas++;
  console.log(`${cond ? 'OK   ' : 'FALHA'} ${nome.padEnd(48)}${detalhe ? `  ${detalhe}` : ''}`);
};

const cliente = await pool.connect();

const quem = await cliente.query('select current_user, current_database()');
const usuario = quem.rows[0].current_user;
console.log(`Conectado como ${usuario} em ${quem.rows[0].current_database}`);
if (usuario !== ROLE) {
  console.log(
    `\n⚠️  A conexão NÃO é o role da API. Os testes abaixo perguntam pelo privilégio de\n` +
      `    '${ROLE}' PELO NOME, então continuam válidos — mas o DATABASE_URL deste ambiente\n` +
      `    aponta para '${usuario}'. Em produção ele tem que ser '${ROLE}'\n` +
      `    (sql/least-privilege-role.sql: "NÃO usar 'postgres'").`,
  );
}
console.log('');

const existe = await cliente.query('select 1 from pg_roles where rolname = $1', [ROLE]);
ok(`role ${ROLE} existe`, existe.rowCount === 1);
if (existe.rowCount !== 1) {
  console.log('\nSem o role não há o que conferir. Rode sql/least-privilege-role.sql.');
  cliente.release();
  await pool.end();
  process.exit(1);
}

// 1) Privilégio DO ROLE, pelo nome — não do usuário conectado.
for (const [tabela, privilegios] of ALVOS) {
  for (const priv of privilegios) {
    const { rows } = await cliente.query('select has_table_privilege($1, $2, $3) as pode', [
      ROLE,
      tabela,
      priv,
    ]);
    ok(`${tabela} ${priv}`, rows[0].pode === true);
  }
}

// 1b) E o que o role NÃO pode ter. `has_table_privilege` lança se a tabela não existir —
//     tabela ausente é, para o nosso fim, o mesmo que privilégio ausente.
for (const [tabela, priv, motivo] of PROIBIDOS) {
  let pode = false;
  try {
    const { rows } = await cliente.query('select has_table_privilege($1, $2, $3) as pode', [
      ROLE,
      tabela,
      priv,
    ]);
    pode = rows[0].pode === true;
  } catch {
    pode = false; // tabela não existe neste banco
  }
  ok(`${tabela} ${priv} NEGADO`, !pode, pode ? `⚠️ ainda concedido — ${motivo}` : motivo);
}

// 2) A leitura RESOLVE sob o role? Só dá para provar assumindo o role.
//    `set role` exige que o usuário conectado seja membro dele (ou superusuário).
let assumiu = false;
try {
  await cliente.query(`set role ${ROLE}`);
  assumiu = true;
} catch (e) {
  console.log(`\n(sem 'set role ${ROLE}': ${e.message} — pulando a prova de resolução)`);
}

if (assumiu) {
  console.log('');
  for (const [tabela, , provaLeitura] of ALVOS) {
    if (!provaLeitura) continue;
    try {
      // `limit 0`: prova que a consulta resolve (permissão + existência + view) sem
      // trazer nem uma linha de dado de produção para este terminal.
      await cliente.query(`select * from ${tabela} limit 0`);
      ok(`${tabela} select resolve sob o role`, true);
    } catch (e) {
      ok(`${tabela} select resolve sob o role`, false, e.message);
    }
  }

  await cliente.query('reset role');
}

// 3) A base de conhecimento deste produto está lá?
//
//    Fora do `set role` de propósito: o role da API NÃO lê mais esta tabela (quem monta o prompt
//    é o EasyBilling). Mas a pergunta continua valendo para nós, porque a resposta que o cliente
//    do EasyFood recebe sai DAQUI — e a falha é traiçoeira: sem conteúdo, o assistente não dá
//    erro, ele INVENTA. Já aconteceu: mandava o usuário para um menu "Financeiro" inexistente.
//
//    Manter a base em dia é responsabilidade deste produto (ADR-0003): conhecimento entra como
//    DADO, uma linha por módulo, não como prompt no código de outro repositório.
try {
  const { rows } = await cliente.query(
    `select coalesce(length(content), 0) as bytes, is_active
       from billing.ai_kb_topics where app = 'easyfood-manager'`,
  );
  const linha = rows[0];
  ok('KB do easyfood-manager existe', !!linha, linha ? `${linha.bytes} bytes` : 'linha AUSENTE');
  ok(
    'KB ativa e com conteúdo (senão o assistente inventa)',
    !!linha && linha.bytes > 0 && linha.is_active === true,
  );
} catch (e) {
  ok('KB do easyfood-manager existe', false, e.message);
}

cliente.release();
await pool.end();
console.log(`\n${falhas === 0 ? 'Tudo verde.' : `${falhas} falha(s).`}`);
process.exit(falhas === 0 ? 0 : 1);
