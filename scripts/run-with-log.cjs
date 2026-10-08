'use strict';

/**
 * Sobe a API guardando o `stdout`/`stderr` num arquivo, SEM deixar de mostrar no console.
 *
 * ► POR QUE ISTO EXISTE (e por que NÃO virou sink de arquivo no logger)
 *
 *   `easysoft-logger.ts` escreve só na saída padrão de propósito, e a razão está escrita
 *   lá: em produção a API roda em contêiner descartável, e quem recolhe é o Docker —
 *   `deploy/docker-compose.prod.yml` limita com `json-file`, `max-size: 10m`,
 *   `max-file: 3`. Pôr arquivo dentro do contêiner contrariaria essa decisão.
 *
 *   O buraco é só LOCAL: no Windows a API é lançada destacada, e o console morre com o
 *   processo. Em 17/09/2026 isso custou um diagnóstico: o Sync registou 3.458 falhas de
 *   push com `HTTP 500` e `requestId: api-mu60erecbb4150`; o `HttpExceptionFilter` tinha
 *   logado do outro lado a causa e o stack com esse MESMO id — num console que já não
 *   existia. A correlação estava desenhada e era inutilizável.
 *
 *   Aqui o problema é do LANÇADOR, não do logger. Por isso a solução fica fora dele.
 *
 * ► USO
 *
 *   npm run start:logged            (arquivo em ./logs/api-AAAA-MM-DD.log)
 *   LOG_DIR=D:\logs npm run start:logged
 *
 *   Repassa o código de saída do filho, para que um supervisor continue a ver a falha.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RETENCAO_DIAS = Number(process.env.LOG_RETENTION_DAYS) || 7;
const raiz = path.join(__dirname, '..');
const dir = path.resolve(process.env.LOG_DIR || path.join(raiz, 'logs'));

fs.mkdirSync(dir, { recursive: true });

/** Apaga `api-*.log` mais velho que a retenção. Nunca derruba o arranque. */
function reciclar() {
  const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
  try {
    for (const nome of fs.readdirSync(dir)) {
      if (!/^api-\d{4}-\d{2}-\d{2}\.log$/i.test(nome)) continue;
      const alvo = path.join(dir, nome);
      if (fs.statSync(alvo).mtimeMs < limite) fs.unlinkSync(alvo);
    }
  } catch {
    /* reciclagem nunca impede a API de subir */
  }
}

reciclar();

const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const arquivo = path.join(dir, `api-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.log`);
const saida = fs.createWriteStream(arquivo, { flags: 'a' });

// Marca o arranque: sem isto, dois arranques no mesmo dia viram um borrão só.
saida.write(`\n# ---- arranque ${d.toISOString()} | pid do lancador ${process.pid} ----\n`);

const filho = spawn(process.execPath, ['--enable-source-maps', path.join(raiz, 'dist', 'main.js')], {
  cwd: raiz,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

filho.stdout.pipe(process.stdout);
filho.stdout.pipe(saida);
filho.stderr.pipe(process.stderr);
filho.stderr.pipe(saida);

// Ctrl+C / kill do supervisor tem de chegar ao filho, senão fica API órfã a segurar a 3010.
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sinal, () => filho.kill(sinal));
}

filho.on('exit', (codigo, sinal) => {
  saida.write(`# ---- saida ${new Date().toISOString()} | codigo=${codigo} sinal=${sinal || '-'} ----\n`);
  process.exitCode = codigo === null ? 1 : codigo;
});
