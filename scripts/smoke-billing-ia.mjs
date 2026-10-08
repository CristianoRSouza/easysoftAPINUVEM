/**
 * Smoke ponta a ponta de BILLING e IA — a corrente inteira, pelo HTTP.
 *
 *   login → cookie httpOnly → tenant em header → créditos/licença/planos → chat SSE
 *   → e a prova final: o uso apareceu em billing.usage_log?
 *
 * É o que a tela faz, sem a tela. Se isto passa, o que sobra é UI.
 *
 * USO (senha SEMPRE do ambiente — argumento fica no histórico do shell):
 *
 *   EASYFOOD_EMAIL=voce@easysoft... EASYFOOD_SENHA=... node scripts/smoke-billing-ia.mjs
 *
 *   Opcionais:
 *     EASYFOOD_API=http://127.0.0.1:3010   (padrão)
 *     EASYFOOD_EMPRESA=<uuid>              (padrão: 1ª empresa que casar com /nome/)
 *     EASYFOOD_LOJA=<uuid>                 (padrão: 1ª loja da empresa escolhida)
 *     PULAR_CHAT=1                         (não chama o gateway de IA)
 *
 * NÃO imprime senha, token, nome de empresa/loja nem conteúdo de conversa. Só status,
 * contagens e os estados que importam para o diagnóstico.
 *
 * ⚠️ ESCREVE (de propósito, é o ponto do teste): grava e apaga uma conversa de teste em
 * billing.ai_chat_sessions e, se o chat rodar, gera uma linha em billing.usage_log +
 * public.activity_logs. Rode contra uma empresa SUA.
 */
const BASE = (process.env.EASYFOOD_API || 'http://127.0.0.1:3010').replace(/\/+$/, '');
const EMAIL = process.env.EASYFOOD_EMAIL;
const SENHA = process.env.EASYFOOD_SENHA;
const EMPRESA_FIXA = process.env.EASYFOOD_EMPRESA;
const LOJA_FIXA = process.env.EASYFOOD_LOJA;
const PULAR_CHAT = process.env.PULAR_CHAT === '1';

if (!EMAIL || !SENHA) {
  console.error('Defina EASYFOOD_EMAIL e EASYFOOD_SENHA no ambiente.');
  process.exit(2);
}

let cookie = '';
let falhas = 0;
let empresa = EMPRESA_FIXA || '';
let loja = LOJA_FIXA || '';

const ok = (nome, cond, detalhe = '') => {
  if (!cond) falhas++;
  console.log(`${cond ? 'OK   ' : 'FALHA'} ${nome.padEnd(56)}${detalhe ? `  ${detalhe}` : ''}`);
};
const secao = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`);

async function chamar(caminho, { method = 'GET', body, tenant = true, headers = {} } = {}) {
  const h = {
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(tenant && empresa ? { 'X-Company-Id': empresa } : {}),
    ...(tenant && loja ? { 'X-Store-Id': loja } : {}),
    ...headers,
  };
  const res = await fetch(`${BASE}/api/v1${caminho}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* não-JSON */
  }
  return { status: res.status, json };
}

console.log(`Smoke de billing e IA contra ${BASE}`);

// ─────────────────────────────────────────────────────────────────────────────
secao('Sessão');

const semSessao = await chamar('/billing/license', { tenant: false });
ok('rota de billing sem sessão nega', semSessao.status === 401, `HTTP ${semSessao.status}`);

const login = await chamar('/auth/login', { method: 'POST', tenant: false, body: { email: EMAIL, password: SENHA } });
ok('login', login.status === 200, `HTTP ${login.status}`);
ok('cookie de sessão recebido', cookie.length > 0);
ok('token NÃO vem no corpo (senão o httpOnly não serviria)', login.json != null && !JSON.stringify(login.json).match(/token/i));
if (login.status !== 200) {
  console.log('\nSem sessão não dá para seguir. Confira e-mail/senha e se a API aponta para o banco certo.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
secao('Tenant');

const ctx = await chamar('/me/context', { tenant: false });
ok('/me/context responde', ctx.status === 200, `${ctx.json?.companies?.length ?? 0} empresa(s)`);

if (!empresa) {
  const alvo = (ctx.json?.companies ?? []).find((c) => /easysoft/i.test(c.name ?? ''));
  empresa = alvo?.id ?? ctx.json?.companies?.[0]?.id ?? '';
}
ok('empresa resolvida', !!empresa, empresa ? `…${empresa.slice(-12)}` : 'NENHUMA');

const lojas = await chamar('/me/stores');
ok('/me/stores responde', lojas.status === 200, `${Array.isArray(lojas.json) ? lojas.json.length : 0} loja(s)`);
if (!loja) loja = (Array.isArray(lojas.json) ? lojas.json : [])[0]?.id ?? '';
ok('loja resolvida', !!loja, loja ? `…${loja.slice(-12)}` : 'NENHUMA');
if (!empresa || !loja) {
  console.log('\nSem empresa/loja não dá para seguir.');
  process.exit(1);
}

// O header é ALVO, não credencial: apontar para empresa alheia tem que dar 403.
const alheia = await chamar('/billing/license', { headers: { 'X-Company-Id': '00000000-0000-4000-8000-000000000000' } });
ok('empresa de outro dá 403, não dados', alheia.status === 403 || alheia.status === 400, `HTTP ${alheia.status}`);

// Rota de loja sem X-Store-Id tem que recusar — é @RequireStore.
const semLoja = await chamar('/billing/credits', { headers: { 'X-Store-Id': '' } });
ok('/billing/credits sem loja recusa', semLoja.status === 400, `HTTP ${semLoja.status} ${semLoja.json?.error ?? ''}`);

// ─────────────────────────────────────────────────────────────────────────────
secao('Billing — leitura');

const lic = await chamar('/billing/license');
ok('GET /billing/license', lic.status === 200, `HTTP ${lic.status}`);
const L = lic.json?.data;
ok('licença classificada pelo servidor', !!L?.state,
   L ? `state=${L.state} plano=${L.planSlug ?? '—'} dias=${L.daysUntilExpiry ?? '—'}` : '');
ok('estado é um dos quatro previstos', ['active', 'expiring_soon', 'expired', 'unknown'].includes(L?.state));

const janela = await chamar('/billing/plan-window');
ok('GET /billing/plan-window', janela.status === 200, `HTTP ${janela.status}`);
ok('janela do plano coerente', janela.json?.data !== undefined,
   `dias=${janela.json?.data?.historyWindowDays ?? 'sem limite'}`);

const planos = await chamar('/billing/plans');
ok('GET /billing/plans', planos.status === 200, `${planos.json?.data?.length ?? 0} plano(s)`);
const vazouStripe = JSON.stringify(planos.json ?? {}).match(/stripe/i);
ok('catálogo NÃO vaza nada de Stripe', !vazouStripe);

const cred = await chamar('/billing/credits');
ok('GET /billing/credits', cred.status === 200, `${cred.json?.data?.length ?? 0} transação(ões)`);
const saldo = (cred.json?.data ?? []).reduce((s, t) => s + Number(t.amount), 0);
ok('saldo é somável (amount veio número, não string)',
   (cred.json?.data ?? []).every((t) => typeof t.amount === 'number'), `saldo=${saldo}`);
ok('resposta não ecoa company_id/store_id',
   (cred.json?.data ?? []).every((t) => !('company_id' in t) && !('store_id' in t)));

const uso = await chamar('/billing/usage');
ok('GET /billing/usage', uso.status === 200, `${uso.json?.data?.length ?? 0} registro(s)`);
const usosAntes = uso.json?.data?.length ?? 0;

// ─────────────────────────────────────────────────────────────────────────────
secao('IA — histórico');

const ses = await chamar('/ai/sessions');
ok('GET /ai/sessions', ses.status === 200, `${ses.json?.data?.length ?? 0} conversa(s)`);

const marcador = `smoke-${Date.now()}`;
const grava = await chamar('/ai/sessions/today', {
  method: 'PUT',
  body: { messages: [{ role: 'user', content: marcador }] },
});
ok('PUT /ai/sessions/today grava', grava.status === 200 && !!grava.json?.data?.id, `HTTP ${grava.status}`);

const conferindo = await chamar('/ai/sessions');
const achou = (conferindo.json?.data ?? []).some((s) =>
  (s.messages ?? []).some((m) => m.content === marcador));
ok('a conversa gravada volta na listagem', achou);

const apaga = await chamar('/ai/sessions/today', { method: 'PUT', body: { messages: [] } });
ok('PUT com lista vazia APAGA a conversa do dia', apaga.status === 200 && apaga.json?.data === null, `HTTP ${apaga.status}`);

const depoisDeApagar = await chamar('/ai/sessions');
const aindaTem = (depoisDeApagar.json?.data ?? []).some((s) =>
  (s.messages ?? []).some((m) => m.content === marcador));
ok('e ela some mesmo (limpeza do smoke)', !aindaTem);

// ─────────────────────────────────────────────────────────────────────────────
secao(PULAR_CHAT ? 'IA — chat (PULADO)' : 'IA — chat');

if (!PULAR_CHAT) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/v1/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Cookie: cookie,
      'X-Company-Id': empresa,
      'X-Store-Id': loja,
    },
    // Pergunta de NAVEGAÇÃO: a resposta sai da base de conhecimento, então é `support`
    // (grátis e não consome a cota) — mas exercita a corrente inteira do mesmo jeito.
    // A base de conhecimento que responde é a do EasyBilling: se vier resposta genérica ou
    // inventada, o problema é a linha deste produto em `billing.ai_kb_topics`, não este código.
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Onde eu vejo os pedidos do dia?' }] }),
  });

  ok('POST /ai/chat responde 200', res.status === 200, `HTTP ${res.status}`);
  ok('resposta é um stream SSE', (res.headers.get('content-type') ?? '').includes('text/event-stream'));

  if (res.status === 200 && res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', texto = '', pedacos = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const linha = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!linha.startsWith('data: ')) continue;
        const j = linha.slice(6).trim();
        if (j === '[DONE]') continue;
        try {
          const c = JSON.parse(j)?.choices?.[0]?.delta?.content;
          if (c) { texto += c; pedacos++; }
        } catch { /* pedaço partido */ }
      }
    }
    ok('o assistente respondeu de verdade', texto.length > 20, `${texto.length} chars em ${pedacos} pedaços, ${Date.now() - t0}ms`);
    ok('marcador interno NÃO vaza para a tela', !texto.includes('intent:'));
  } else if (res.status === 503) {
    const j = await res.json().catch(() => ({}));
    console.log(`     (${j.error ?? 'ai indisponível'} — falta AI_SERVICE_SHARED_SECRET no .env da API,`);
    console.log('      ou o EasyBilling está fora do ar / com o segredo diferente do nosso.)');
  }

  // A prova que fecha o circuito: o uso foi REGISTRADO? Quem grava agora é o EasyBilling
  // (ADR-0003), com a service_role dele — esta API só LÊ o extrato. Ver a linha aparecer aqui
  // prova a corrente inteira: encaminhamento, token de serviço, cobrança lá e leitura de volta.
  //
  // Se o chat respondeu mas nada aparece, o suspeito é o `store_id`: o EasyBilling precisa
  // gravá-lo para a linha entrar no recorte por loja que esta tela usa.
  const usoDepois = await chamar('/billing/usage');
  const usosDepois = usoDepois.json?.data?.length ?? 0;
  ok('o uso foi registrado em billing.usage_log', usosDepois > usosAntes, `${usosAntes} → ${usosDepois}`);
  const ultimo = (usoDepois.json?.data ?? [])[0];
  if (ultimo) {
    // `app_source` passou a receber o SLUG do produto (antes era a constante "ai-chat" para
    // todo mundo, o que tornava impossível saber quanto cada produto gastou).
    ok('a linha é deste produto e do assistente',
       ultimo.app_source === 'easyfood-manager' && ultimo.service_type === 'ai',
       `action=${ultimo.action} was_free=${ultimo.was_free} créditos=${ultimo.credits_consumed}`);
    ok('platform_display_name veio da view (não da tabela crua)', ultimo.platform_display_name != null,
       String(ultimo.platform_display_name ?? '—'));
  }
}

console.log(`\n${falhas === 0 ? '✅ Tudo verde.' : `❌ ${falhas} falha(s).`}`);
process.exit(falhas === 0 ? 0 : 1);
