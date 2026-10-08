/**
 * Backfill do XML fiscal para o bucket (Fase 4 do D7).
 *
 * Sobe ao `fiscal-xml` o XML das notas/inutilizações/eventos que JÁ estão no banco e grava
 * as colunas `storage_*` da linha. Não apaga nada: a coluna `text` continua intacta — quem
 * a esvazia é a Fase 5, e só depois do portão de conferência.
 *
 * ── O QUE ESTE SCRIPT NÃO FAZ, E É DE PROPÓSITO ───────────────────────────────
 * Ele NÃO monta o caminho no bucket. Manda os metadados para a EasyFood API e ela deriva o
 * object path. A regra (ano/mês pelo fuso do emitente, fallback de nota sem chave) também
 * nomeia os arquivos do ZIP do contador — duas implementações divergiriam em silêncio.
 *
 * ── PAGINAÇÃO POR `id`, NÃO POR `OFFSET` ──────────────────────────────────────
 * O PDV emite durante a varredura. Com `offset`, uma nota nova desloca todas as páginas
 * seguintes e o backfill pularia linhas sem erro nenhum. Por `id` a varredura é estável.
 *
 * ── IDEMPOTENTE ───────────────────────────────────────────────────────────────
 * Só processa linha com XML e SEM referência. Rodar duas vezes não duplica: o upload é
 * `upsert:false` com conflito tratado como sucesso (o caminho vem do próprio documento).
 *
 * ⚠️ CONFIRA O PROJETO. Em 15/09/2026 um teste rodou contra HOMOLOG achando que era
 *    produção, e a conferência em produção reportou "objeto faltando" para um objeto que
 *    existia — no outro banco. Por isso este script IMPRIME o projeto e exige --confirmar
 *    para escrever.
 *
 * Uso:
 *   node scripts/backfill-nfce-xml-storage.mjs --api http://localhost:3011/api/v1
 *   node scripts/backfill-nfce-xml-storage.mjs --api https://… --confirmar [--limite N]
 *
 * Sem `--confirmar` roda em modo ENSAIO: lê, mostra o que faria, e não escreve.
 */
import 'dotenv/config';
import pg from 'pg';

const args = process.argv.slice(2);
const opt = (nome, padrao = undefined) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : padrao;
};
const API = (opt('--api') || process.env.BACKFILL_API_BASE || '').replace(/\/$/, '');
const CONFIRMAR = args.includes('--confirmar');
const LIMITE = Number(opt('--limite', '0')) || 0;
const LOTE = 100;

/**
 * ⚠️ O BANCO SAI DO `DATABASE_URL` DO .env, E DE MAIS LUGAR NENHUM.
 *
 * A primeira versão fazia `SUPABASE_DB_URL || DATABASE_URL`, copiado dos scripts de
 * diagnóstico. Em 16/09/2026 isso quase escreveu em produção: `SUPABASE_DB_URL` estava
 * definida no AMBIENTE (não no .env) apontando para produção, enquanto o .env apontava para
 * homolog. O ensaio leu 1.424 notas de produção achando que lia as 141 de homolog — e o
 * cabeçalho ainda IMPRIMIA "homolog", porque o projeto vinha do `SUPABASE_URL` em vez de vir
 * da conexão real. Um painel que mente é pior que um painel ausente.
 *
 * Por isso: uma fonte só, e o projeto lido do HOST DA CONEXÃO. Para apontar noutro lugar,
 * passe `--db <url>` explicitamente — nunca por variável de ambiente herdada.
 */
const DB = opt('--db') || process.env.DATABASE_URL;
const CHAVE = process.env.SERVICE_API_KEY;

if (!DB || !CHAVE || !API) {
  console.error('Faltam DATABASE_URL (.env), SERVICE_API_KEY (.env) ou --api <url>.');
  process.exit(2);
}

/** Projeto lido do host/usuário da própria string de conexão — a fonte que não mente. */
const refNoHost = DB.match(/db\.([a-z]{20})\.supabase\.co/);
const refNoUser = DB.match(/postgres\.([a-z]{20})/);
const PROJETO = (refNoHost || refNoUser || [])[1] || '(nao identificado)';
const HOST = (DB.match(/@([^:/]+)/) || [])[1] || '(?)';
const PROJETO_ESPERADO = opt('--projeto');

console.log('==========================================================');
console.log(`  BANCO (host)     : ${HOST}`);
console.log(`  PROJETO          : ${PROJETO}`);
console.log(`  API              : ${API}`);
console.log(`  MODO             : ${CONFIRMAR ? 'GRAVANDO' : 'ENSAIO (não escreve)'}`);
if (LIMITE) console.log(`  LIMITE           : ${LIMITE} documento(s)`);
console.log('==========================================================\n');

// Para GRAVAR é preciso digitar o projeto de destino, e ele tem que bater com o da conexão.
// Escrever no banco errado deixa de ser um descuido possível e passa a exigir um erro de
// digitação deliberado.
if (CONFIRMAR && PROJETO_ESPERADO !== PROJETO) {
  console.error(
    'RECUSADO: com --confirmar é obrigatório --projeto <ref>, igual ao da conexão.\n' +
      `  conexão aponta para : ${PROJETO}\n` +
      `  --projeto informado : ${PROJETO_ESPERADO || '(ausente)'}`,
  );
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: DB, max: 2, ssl: { rejectUnauthorized: false } });

const stats = { lidos: 0, subidos: 0, pulados: 0, erros: 0, bytes: 0 };
const falhas = [];

/**
 * Ritmo dos uploads.
 *
 * A API tem rate-limit (`RATE_LIMIT_LIMIT`, default 300 por `RATE_LIMIT_TTL_SECONDS` 60).
 * A primeira execução em produção (16/09/2026) disparou o mais rápido que conseguia:
 * subiu exatamente 300 documentos e levou **2.547 respostas 429** em seguida. Nada se
 * perdeu — o script é idempotente e a re-execução retoma —, mas foi trabalho jogado fora e
 * um minuto de API ocupada à toa.
 *
 * Aqui o ritmo é do CLIENTE, não do servidor: um intervalo mínimo entre uploads que mantém
 * a taxa abaixo do teto. Baixar o teto do servidor seria pior — ele protege a API de todo
 * mundo, e quem sabe que vai mandar 2.847 arquivos é quem chama.
 */
const RPM = Number(opt('--rpm', '240')) || 240;
const INTERVALO_MS = Math.ceil(60000 / RPM);
let proximoEnvio = 0;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function aguardarVez() {
  const agora = Date.now();
  if (proximoEnvio > agora) await dormir(proximoEnvio - agora);
  proximoEnvio = Math.max(agora, proximoEnvio) + INTERVALO_MS;
}

/** Sobe um XML pela API e devolve a referência. Respeita o ritmo e re-tenta 429. */
async function subir(campos, xml, tentativa = 1) {
  await aguardarVez();
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(Buffer.from(xml, 'utf8'))]), 'x.xml');
  for (const [k, v] of Object.entries(campos)) {
    if (v !== null && v !== undefined && v !== '') form.append(k, String(v));
  }
  const res = await fetch(`${API}/storage/fiscal-xml`, {
    method: 'POST',
    headers: { 'X-Service-Key': CHAVE },
    body: form,
  });
  const txt = await res.text();

  // 429 não é erro do documento: é a janela do rate-limit. Esperar e repetir é o certo —
  // desistir marcaria como falha um arquivo que só precisava da vez dele.
  if (res.status === 429 && tentativa <= 4) {
    const espera = Number(res.headers.get('retry-after')) * 1000 || 62000;
    console.log(`  (429 — aguardando ${Math.round(espera / 1000)}s, tentativa ${tentativa})`);
    await dormir(espera);
    proximoEnvio = 0;
    return subir(campos, xml, tentativa + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  return JSON.parse(txt);
}

/** `authorized` | `signed` | `cancellation` — `generated` fica fora (D-1: é INI, não XML). */
const KINDS_DA_NOTA = ['authorized', 'signed', 'cancellation'];

async function backfillNotas() {
  console.log('--- nfce.notes ---');
  let depoisDe = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    if (LIMITE && stats.lidos >= LIMITE) break;
    const { rows } = await pool.query(
      `SELECT id::text, issued_at::text AS issued_at, company_id::text, store_id::text,
              model, number, serie, access_key,
              authorized_xml, signed_xml, cancellation_xml,
              storage_authorized_xml_path, storage_signed_xml_path, storage_cancellation_xml_path
         FROM nfce.notes
        WHERE id > $1::uuid
          AND (authorized_xml IS NOT NULL OR signed_xml IS NOT NULL OR cancellation_xml IS NOT NULL)
        ORDER BY id
        LIMIT ${LOTE}`,
      [depoisDe],
    );
    if (rows.length === 0) break;
    depoisDe = rows[rows.length - 1].id;

    for (const n of rows) {
      if (LIMITE && stats.lidos >= LIMITE) break;
      stats.lidos += 1;
      const refs = {};
      for (const kind of KINDS_DA_NOTA) {
        const xml = n[`${kind}_xml`];
        const jaTem = n[`storage_${kind}_xml_path`];
        if (!xml || String(xml).trim() === '') continue;
        if (jaTem) { stats.pulados += 1; continue; }
        if (!CONFIRMAR) { stats.subidos += 1; stats.bytes += Buffer.byteLength(xml); continue; }
        try {
          const r = await subir(
            {
              documento: 'nota', companyId: n.company_id, storeId: n.store_id,
              model: n.model || '65', issuedAt: n.issued_at, accessKey: n.access_key,
              number: n.number, serie: n.serie, noteId: n.id, kind,
            },
            xml,
          );
          refs[kind] = r;
          stats.subidos += 1;
          stats.bytes += r.bytes;
        } catch (e) {
          stats.erros += 1;
          falhas.push(`nota ${n.id} ${kind}: ${e.message}`);
        }
      }
      if (CONFIRMAR && Object.keys(refs).length > 0) {
        const set = [];
        const vals = [n.id, n.issued_at];
        for (const [kind, r] of Object.entries(refs)) {
          const i = vals.length;
          set.push(
            `storage_${kind}_xml_bucket = $${i + 1}`,
            `storage_${kind}_xml_path = $${i + 2}`,
            `storage_${kind}_xml_sha256 = $${i + 3}`,
            `storage_${kind}_xml_bytes = $${i + 4}`,
          );
          vals.push(r.bucket, r.objectPath, r.sha256, r.bytes);
        }
        // Escopo por (id, issued_at): a tabela é particionada e a PK é composta.
        await pool.query(
          `UPDATE nfce.notes SET ${set.join(', ')}
            WHERE id = $1::uuid AND issued_at = $2::timestamptz`,
          vals,
        );
      }
      if (stats.lidos % 100 === 0) console.log(`  ${stats.lidos} notas lidas…`);
    }
  }
  console.log(`  notas lidas: ${stats.lidos}\n`);
}

async function backfillInutilizacoes() {
  console.log('--- nfce.inutilizations ---');
  const { rows } = await pool.query(
    `SELECT id::text, created_at::text, company_id::text, store_id::text,
            year, model, serie, number_start, number_end, xml_content
       FROM nfce.inutilizations
      WHERE xml_content IS NOT NULL AND xml_storage_path IS NULL
      ORDER BY id`,
  );
  console.log(`  a migrar: ${rows.length}`);
  for (const u of rows) {
    if (!CONFIRMAR) { stats.subidos += 1; continue; }
    try {
      const r = await subir(
        {
          documento: 'inutilizacao', companyId: u.company_id, storeId: u.store_id,
          model: u.model || '65', year: u.year, serie: u.serie,
          numberStart: u.number_start, numberEnd: u.number_end,
        },
        u.xml_content,
      );
      await pool.query(
        `UPDATE nfce.inutilizations
            SET xml_storage_bucket = $3, xml_storage_path = $4,
                xml_content_sha256 = $5, xml_storage_bytes = $6
          WHERE id = $1::uuid AND created_at = $2::timestamptz`,
        [u.id, u.created_at, r.bucket, r.objectPath, r.sha256, r.bytes],
      );
      stats.subidos += 1;
      stats.bytes += r.bytes;
    } catch (e) {
      stats.erros += 1;
      falhas.push(`inutilizacao ${u.id}: ${e.message}`);
    }
  }
  console.log('');
}

async function backfillEventos() {
  console.log('--- nfce.events ---');
  const { rows } = await pool.query(
    `SELECT e.id::text, e.note_issued_at::text, e.company_id::text, e.store_id::text,
            e.note_id::text, e.event_type, e.event_sequence,
            e.event_xml, e.event_response_xml,
            e.request_storage_path, e.response_storage_path,
            n.access_key, n.number, n.serie, n.model
       FROM nfce.events e
       LEFT JOIN nfce.notes n ON n.id = e.note_id AND n.issued_at = e.note_issued_at
      WHERE (e.event_xml IS NOT NULL OR e.event_response_xml IS NOT NULL)
      ORDER BY e.id`,
  );
  console.log(`  candidatos: ${rows.length}`);
  for (const ev of rows) {
    for (const [kind, coluna, refCol] of [
      ['request', 'event_xml', 'request_storage_path'],
      ['response', 'event_response_xml', 'response_storage_path'],
    ]) {
      const xml = ev[coluna];
      if (!xml || ev[refCol]) continue;
      if (!CONFIRMAR) { stats.subidos += 1; continue; }
      try {
        const r = await subir(
          {
            documento: 'evento', companyId: ev.company_id, storeId: ev.store_id,
            model: ev.model || '65', noteIssuedAt: ev.note_issued_at,
            accessKey: ev.access_key, number: ev.number, serie: ev.serie,
            noteId: ev.note_id, eventType: ev.event_type,
            eventSequence: ev.event_sequence, kind,
          },
          xml,
        );
        await pool.query(
          `UPDATE nfce.events
              SET ${kind}_storage_bucket = $3, ${kind}_storage_path = $4,
                  ${kind}_storage_sha256 = $5
            WHERE id = $1::uuid AND note_issued_at = $2::timestamptz`,
          [ev.id, ev.note_issued_at, r.bucket, r.objectPath, r.sha256],
        );
        stats.subidos += 1;
        stats.bytes += r.bytes;
      } catch (e) {
        stats.erros += 1;
        falhas.push(`evento ${ev.id} ${kind}: ${e.message}`);
      }
    }
  }
  console.log('');
}

try {
  await backfillNotas();
  await backfillInutilizacoes();
  await backfillEventos();

  console.log('=== RESUMO ===');
  console.log(`  documentos ${CONFIRMAR ? 'subidos' : 'que subiriam'} : ${stats.subidos}`);
  console.log(`  já tinham referência (pulados)      : ${stats.pulados}`);
  console.log(`  bytes                               : ${(stats.bytes / 1048576).toFixed(2)} MB`);
  console.log(`  erros                               : ${stats.erros}`);
  if (falhas.length) {
    console.log('\n  primeiras falhas:');
    for (const f of falhas.slice(0, 10)) console.log(`    - ${f}`);
  }
  if (!CONFIRMAR) console.log('\n  ENSAIO: nada foi escrito. Use --confirmar para valer.');
} finally {
  await pool.end();
}
process.exit(stats.erros > 0 ? 1 : 0);
