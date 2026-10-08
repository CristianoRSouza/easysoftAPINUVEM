/**
 * Trava do CONTRATO HTTP — responde: "esta mudança alterou o que a API expõe?"
 *
 * Sobe o AppModule compilado (`dist/`) SEM abrir porta e SEM tocar o banco, e extrai:
 *   • rotas       — método + caminho + handler, com as marcas que decidem quem entra
 *                   (@Public, @ServiceOnly, @SkipTenant, @RequireStore, @Throttle, @HttpCode);
 *   • guards      — os APP_GUARD globais, NA ORDEM (a ordem é contrato: ver app.module.ts);
 *   • openapi     — paths e schemas do documento que o Swagger publica.
 *
 * Uso:
 *   npm run build && node scripts/contrato-http.mjs            # confere contra o snapshot
 *   npm run build && node scripts/contrato-http.mjs --atualizar # regrava o snapshot
 *   node scripts/contrato-http.mjs --completo antes.json        # despeja tudo, para diff
 *
 * Refatoração NÃO pode mudar este arquivo. Se o snapshot mudou, ou a mudança de contrato
 * é intencional (e aí o front e a Admin-API da loja precisam saber), ou é regressão.
 *
 * Não lê `.env`: o ambiente abaixo é FALSO de propósito. O pool do `pg` só conecta na
 * primeira query, e nada aqui consulta.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(RAIZ, 'test', 'contrato', 'contrato-http.snapshot.json');
const require = createRequire(import.meta.url);

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  API_PREFIX: 'api/v1',
  SERVICE_API_KEY: 'x'.repeat(40),
  SUPABASE_URL: 'http://127.0.0.1:9',
  SUPABASE_SERVICE_ROLE_KEY: 'chave-falsa-de-contrato',
  DATABASE_URL: 'postgres://ninguem:nada@127.0.0.1:9/contrato',
  DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
  DATABASE_CA_CERT: '',
  SESSION_COOKIE_NAME: 'easyfood_session',
});

if (!existsSync(join(RAIZ, 'dist', 'app.module.js'))) {
  console.error('dist/ não existe — rode `npm run build` antes.');
  process.exit(2);
}

require('reflect-metadata');
const { NestFactory, ModulesContainer } = require('@nestjs/core');
const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');
const { AppModule } = require(join(RAIZ, 'dist', 'app.module.js'));

const METODOS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD', 'SEARCH'];
const MARCAS = ['isPublic', 'isServiceOnly', 'isSkipTenant', 'requiresStore'];

const lista = (v) => (Array.isArray(v) ? v : [v]);
const junta = (...partes) =>
  '/' +
  partes
    .flatMap((p) => String(p ?? '').split('/'))
    .filter(Boolean)
    .join('/');

/**
 * `FileInterceptor()` devolve um mixin cujo nome é um id ALEATÓRIO a cada boot. Sem
 * normalizar, o snapshot mudaria sozinho entre duas execuções do mesmo código.
 */
const nomeEstavel = (nome) => (/^[A-Z][A-Za-z]+$/.test(String(nome)) ? nome : 'mixin');

/** Metadados cujo NOME começa por um prefixo (o throttler grava `THROTTLER:LIMITdefault` etc.). */
function metadadosPorPrefixo(alvo, prefixo) {
  const out = {};
  for (const chave of Reflect.getMetadataKeys(alvo)) {
    if (typeof chave === 'string' && chave.startsWith(prefixo)) {
      out[chave] = Reflect.getMetadata(chave, alvo);
    }
  }
  return out;
}

function extrairRotas(app) {
  const rotas = [];
  for (const modulo of app.get(ModulesContainer).values()) {
    for (const { metatype: classe } of modulo.controllers.values()) {
      if (!classe) continue;
      const bases = lista(Reflect.getMetadata('path', classe) ?? '');
      const proto = classe.prototype;
      for (const nome of Object.getOwnPropertyNames(proto)) {
        const handler = proto[nome];
        if (nome === 'constructor' || typeof handler !== 'function') continue;
        const metodo = Reflect.getMetadata('method', handler);
        if (metodo === undefined) continue;
        const marcas = {};
        for (const marca of MARCAS) {
          const valor = Reflect.getMetadata(marca, handler) ?? Reflect.getMetadata(marca, classe);
          if (valor !== undefined) marcas[marca] = valor;
        }
        const throttle = {
          ...metadadosPorPrefixo(classe, 'THROTTLER:'),
          ...metadadosPorPrefixo(handler, 'THROTTLER:'),
        };
        for (const base of bases) {
          for (const sub of lista(Reflect.getMetadata('path', handler) ?? '')) {
            rotas.push({
              rota: `${METODOS[metodo] ?? metodo} ${junta(base, sub)}`,
              ...marcas,
              ...(Object.keys(throttle).length ? { throttle } : {}),
              ...(Reflect.getMetadata('__httpCode__', handler) !== undefined
                ? { httpCode: Reflect.getMetadata('__httpCode__', handler) }
                : {}),
              ...(Reflect.getMetadata('__headers__', handler)
                ? { headers: Reflect.getMetadata('__headers__', handler) }
                : {}),
              guards: (Reflect.getMetadata('__guards__', handler) ?? [])
                .concat(Reflect.getMetadata('__guards__', classe) ?? [])
                .map((g) => g.name),
              interceptors: (Reflect.getMetadata('__interceptors__', handler) ?? [])
                .concat(Reflect.getMetadata('__interceptors__', classe) ?? [])
                .map((i) => nomeEstavel(i.name ?? i.constructor?.name)),
            });
          }
        }
      }
    }
  }
  return rotas.sort((a, b) => a.rota.localeCompare(b.rota));
}

/** APP_GUARD / APP_FILTER globais, na ordem em que o AppModule os declarou. */
function extrairGlobais() {
  const providers = Reflect.getMetadata('providers', AppModule) ?? [];
  return providers
    .filter((p) => p && typeof p === 'object' && p.useClass)
    .map((p) => `${String(p.provide)} → ${p.useClass.name}`);
}

/** Ordena chaves recursivamente: o snapshot não pode mudar só porque um import mudou de lugar. */
function ordenar(valor) {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.keys(valor)
        .sort()
        .map((k) => [k, ordenar(valor[k])]),
    );
  }
  return valor;
}

const app = await NestFactory.create(AppModule, { logger: false });
app.setGlobalPrefix('api/v1');
await app.init();

const documento = SwaggerModule.createDocument(app, new DocumentBuilder().build(), {
  ignoreGlobalPrefix: true,
});

/**
 * O que NÃO é contrato e por isso fica de fora: o nome da classe/método que atende a rota
 * e o `operationId` (que o Swagger deriva desse nome). Dividir um controller grande em
 * dois não muda nada para quem chama.
 */
function semOperationId(valor) {
  if (Array.isArray(valor)) return valor.map(semOperationId);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([k]) => k !== 'operationId')
        .map(([k, v]) => [k, semOperationId(v)]),
    );
  }
  return valor;
}

const sha = (valor) => createHash('sha256').update(JSON.stringify(valor)).digest('hex').slice(0, 16);

const openapi = ordenar(
  semOperationId({
    paths: documento.paths,
    schemas: documento.components?.schemas ?? {},
    tags: (documento.tags ?? []).map((t) => t.name),
  }),
);

// O documento inteiro passa de 1 MB. No snapshot fica uma IMPRESSÃO DIGITAL por caminho:
// acusa qual rota mudou; para ver O QUE mudou, compare dois `--completo`.
const contrato = {
  globais: extrairGlobais(),
  rotas: extrairRotas(app),
  openapi: {
    paths: Object.fromEntries(Object.entries(openapi.paths).map(([k, v]) => [k, sha(v)])),
    schemas: sha(openapi.schemas),
    tags: openapi.tags,
  },
};
await app.close();

const completo = process.argv.indexOf('--completo');
if (completo !== -1) {
  const destino = process.argv[completo + 1];
  writeFileSync(destino, JSON.stringify({ ...contrato, openapi }, null, 2) + '\n');
  console.log(`contrato completo (sem impressão digital) → ${destino}`);
  process.exit(0);
}

const atual = JSON.stringify(contrato, null, 2) + '\n';

if (process.argv.includes('--atualizar')) {
  mkdirSync(dirname(SNAPSHOT), { recursive: true });
  writeFileSync(SNAPSHOT, atual);
  console.log(`contrato gravado: ${contrato.rotas.length} rotas → ${SNAPSHOT}`);
  process.exit(0);
}

if (!existsSync(SNAPSHOT)) {
  console.error('snapshot ausente — rode com --atualizar para criar.');
  process.exit(2);
}

// Compara pelo conteúdo, não pelos bytes: o git pode ter trocado o fim de linha.
const esperado = JSON.stringify(JSON.parse(readFileSync(SNAPSHOT, 'utf8')), null, 2) + '\n';
if (esperado === atual) {
  console.log(`contrato HTTP intacto: ${contrato.rotas.length} rotas.`);
  process.exit(0);
}

const antes = JSON.parse(esperado);
const rotasAntes = new Map(antes.rotas.map((r) => [r.rota, JSON.stringify(r)]));
const rotasAgora = new Map(contrato.rotas.map((r) => [r.rota, JSON.stringify(r)]));
console.error('CONTRATO HTTP MUDOU:');
for (const [rota] of rotasAntes) if (!rotasAgora.has(rota)) console.error(`  - removida:  ${rota}`);
for (const [rota] of rotasAgora) if (!rotasAntes.has(rota)) console.error(`  + nova:      ${rota}`);
for (const [rota, linha] of rotasAgora) {
  if (rotasAntes.has(rota) && rotasAntes.get(rota) !== linha) console.error(`  ~ alterada:  ${rota}`);
}
if (JSON.stringify(antes.globais) !== JSON.stringify(contrato.globais)) {
  console.error('  ~ guards/filtro globais (ou a ORDEM deles) mudaram');
}
for (const caminho of new Set([...Object.keys(antes.openapi.paths), ...Object.keys(contrato.openapi.paths)])) {
  if (JSON.stringify(antes.openapi.paths[caminho]) !== JSON.stringify(contrato.openapi.paths[caminho])) {
    console.error(`  ~ openapi:   ${caminho}`);
  }
}
console.error('\nSe a mudança é intencional: node scripts/contrato-http.mjs --atualizar');
process.exit(1);
