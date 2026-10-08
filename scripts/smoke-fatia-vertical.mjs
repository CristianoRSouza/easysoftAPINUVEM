/**
 * Smoke da FATIA VERTICAL — a corrente inteira do Caminho 3, pelo HTTP.
 *
 *   login → cookie httpOnly → /me/context → /me/stores → /v1/products
 *
 * É o que a tela vai fazer, sem a tela. Se isto passa, o que sobra é UI; se falha,
 * falha aqui — que é onde custa barato.
 *
 * USO (a senha vem do ambiente, nunca de argumento — argumento fica no histórico do shell):
 *
 *   EASYFOOD_EMAIL=voce@empresa.com EASYFOOD_SENHA=... node scripts/smoke-fatia-vertical.mjs
 *   # opcional: EASYFOOD_API=http://127.0.0.1:3010  (padrão)
 *
 * Nada é impresso além de status e contagens — nem a senha, nem o token, nem nome de
 * empresa ou de produto.
 */
const BASE = (process.env.EASYFOOD_API || 'http://127.0.0.1:3010').replace(/\/+$/, '');
const EMAIL = process.env.EASYFOOD_EMAIL;
const SENHA = process.env.EASYFOOD_SENHA;

if (!EMAIL || !SENHA) {
  console.error('Defina EASYFOOD_EMAIL e EASYFOOD_SENHA no ambiente.');
  process.exit(2);
}

/** Guarda o cookie entre as chamadas — é o que o navegador faz sozinho. */
let cookie = '';
let falhas = 0;

function ok(nome, condicao, detalhe = '') {
  if (!condicao) falhas++;
  console.log(`${condicao ? 'OK   ' : 'FALHA'} ${nome}${detalhe ? `  ${detalhe}` : ''}`);
}

async function chamar(caminho, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${BASE}/api/v1${caminho}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* não-JSON */ }
  return { status: res.status, json };
}

console.log(`Fatia vertical contra ${BASE}\n`);

// 1) Sem sessão, rota de dado tem que negar.
const semSessao = await chamar('/products', { headers: { 'X-Company-Id': '00000000-0000-4000-8000-000000000000' } });
ok('rota de dado sem sessão nega', semSessao.status === 401, `HTTP ${semSessao.status}`);

// 2) Login — o token vem no cookie, não no corpo.
const login = await chamar('/auth/login', { method: 'POST', body: { email: EMAIL, password: SENHA } });
ok('login', login.status === 200, `HTTP ${login.status}`);
ok('cookie de sessão recebido', cookie.length > 0);
ok('token NÃO vem no corpo (senão o httpOnly não serviria)',
   login.json != null && !JSON.stringify(login.json).match(/token/i));
if (login.status !== 200) {
  console.log('\nSem sessão não dá para seguir. Confira e-mail/senha e se a API aponta para o banco certo.');
  process.exit(1);
}

// 3) Contexto — quais empresas este usuário vê.
const ctx = await chamar('/me/context');
ok('/me/context', ctx.status === 200, `HTTP ${ctx.status}`);
const empresas = ctx.json?.companies ?? [];
ok('usuário tem ao menos uma empresa', empresas.length > 0, `${empresas.length} empresa(s)`);
console.log(`     papéis: system_admin=${ctx.json?.is_system_admin} company_admin=${ctx.json?.is_company_admin}`);
if (empresas.length === 0) process.exit(1);
const companyId = empresas[0].id;

// 4) Lojas da empresa — aqui o X-Company-Id já é exigido e conferido.
const semTenant = await chamar('/me/stores');
ok('rota de tenant SEM header nega com 400', semTenant.status === 400, `HTTP ${semTenant.status} (${semTenant.json?.error})`);

const lojas = await chamar('/me/stores', { headers: { 'X-Company-Id': companyId } });
ok('/me/stores', lojas.status === 200, `HTTP ${lojas.status}`);
const listaLojas = Array.isArray(lojas.json) ? lojas.json : [];
ok('empresa tem ao menos uma loja', listaLojas.length > 0, `${listaLojas.length} loja(s)`);

// 5) A prova do isolamento: empresa que não é dele.
const alheia = await chamar('/me/stores', { headers: { 'X-Company-Id': '00000000-0000-4000-8000-0000000000ff' } });
ok('empresa alheia dá 403 (não dados)', alheia.status === 403, `HTTP ${alheia.status} (${alheia.json?.error})`);

if (listaLojas.length === 0) process.exit(falhas > 0 ? 1 : 0);
const storeId = listaLojas[0].id;
const tenant = { 'X-Company-Id': companyId, 'X-Store-Id': storeId };

// 6) Produtos — o dado que a tela mostra.
const prods = await chamar('/products', { headers: tenant });
ok('/v1/products', prods.status === 200, `HTTP ${prods.status}`);
const linhas = prods.json?.data ?? [];
console.log(`     ${linhas.length} produto(s)`);
if (linhas[0]) {
  const p = linhas[0];
  // O contrato que a tela consome: preço é NÚMERO, não string.
  ok('sale_price é number', typeof p.sale_price === 'number', `tipo=${typeof p.sale_price}`);
  ok('stock_quantity é number', typeof p.stock_quantity === 'number', `tipo=${typeof p.stock_quantity}`);
  ok('campos do contrato presentes',
     ['id','description','barcode','is_active','unit_name','created_at'].every((k) => k in p));
}

// 7) Paginada — a que a tela deve usar em catálogo grande.
const pag = await chamar(`/products/paged?from=0&to=4&sortKey=description&sortDir=asc`, { headers: tenant });
ok('/v1/products/paged', pag.status === 200, `HTTP ${pag.status}`);
ok('devolve rows e total', Array.isArray(pag.json?.rows) && typeof pag.json?.total === 'number',
   `${pag.json?.rows?.length ?? 0} de ${pag.json?.total ?? '?'}`);

// 8) Loja de outra empresa — 403, não dados.
const lojaAlheia = await chamar('/products', {
  headers: { 'X-Company-Id': companyId, 'X-Store-Id': '00000000-0000-4000-8000-0000000000ff' },
});
ok('loja alheia dá 403', lojaAlheia.status === 403, `HTTP ${lojaAlheia.status}`);

// 9) Logout encerra a sessão de verdade.
await chamar('/auth/logout', { method: 'POST' });
const posLogout = await chamar('/me/context');
ok('após logout, /me/context nega', posLogout.status === 401, `HTTP ${posLogout.status}`);

console.log(`\n${falhas === 0 ? 'Corrente completa OK.' : `${falhas} falha(s).`}`);
process.exit(falhas > 0 ? 1 : 0);
