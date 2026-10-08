/**
 * Smoke de schema das escritas de totem — SÓ LÊ o catálogo do banco.
 *
 * Um campo com nome errado no payload não quebra em teste unitário nem no typecheck: quebra
 * na hora que alguém salva um totem em produção. Este script pergunta ao banco se cada
 * coluna que a API pretende gravar existe de fato.
 *
 * Nenhuma linha é lida, escrita ou alterada — só `information_schema`.
 *
 *   node scripts/smoke-totem-write-schema.mjs
 */
import 'dotenv/config';
import pg from 'pg';
import { TOTEM_TEF_SECRETS, TOTEM_WRITABLE_KEYS } from '../src/contract/totem-write.schema.ts';

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('SUPABASE_DB_URL ausente no ambiente.');
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });

let falhas = 0;
const ok = (nome, cond, detalhe = '') => {
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!cond) falhas++;
};

try {
  const colunas = async (rel) =>
    new Set(
      (
        await pool.query(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = $1`,
          [rel],
        )
      ).rows.map((r) => r.column_name),
    );

  const cfg = await colunas('vw_devices_totem_config');
  ok('vw_devices_totem_config existe', cfg.size > 0, `${cfg.size} colunas`);

  const esperadas = [
    'totem_name',
    'is_active',
    'company_id',
    'store_id',
    ...TOTEM_WRITABLE_KEYS,
    ...TOTEM_TEF_SECRETS.flatMap((s) => [s.enc, s.kid]),
  ];
  const faltando = esperadas.filter((c) => !cfg.has(c));
  ok('todas as colunas graváveis existem', faltando.length === 0, faltando.join(', ') || 'nenhuma faltando');

  const aud = await colunas('vw_devices_totem_config_audit');
  ok('vw_devices_totem_config_audit existe', aud.size > 0, `${aud.size} colunas`);
  const audEsperadas = [
    'company_id',
    'store_id',
    'totem_config_id',
    'action',
    'changed_fields',
    'previous_values',
    'new_values',
    'performed_by',
  ];
  const audFaltando = audEsperadas.filter((c) => !aud.has(c));
  ok('auditoria tem as colunas usadas', audFaltando.length === 0, audFaltando.join(', ') || 'nenhuma faltando');

  // A regra lê a licença; só leitura, e o guard de fronteira garante que segue só leitura.
  const lic = await pool.query(
    `select count(*)::int n from information_schema.columns
      where table_schema = 'billing' and table_name = 'device_licenses'
        and column_name in ('license_type','plan_slug','totem_config_id')`,
  );
  ok('billing.device_licenses tem os campos da regra', lic.rows[0].n === 3, `${lic.rows[0].n}/3`);

  console.log('');
  console.log(falhas === 0 ? 'schema confere.' : `${falhas} divergência(s) — NÃO commitar assim.`);
  process.exitCode = falhas === 0 ? 0 : 1;
} catch (e) {
  console.error(`falhou: ${e.code || ''} ${e.message}`);
  process.exitCode = 2;
} finally {
  await pool.end();
}
