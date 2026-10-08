# Mapeamento dos endpoints — EasyFood API (NestJS)

Referência completa da **camada 2** do EasyFood: a única porta para o Supabase cloud, no padrão
de 3 camadas do EasyML. Substitui as Edge Functions e o acesso direto ao banco pelo browser.

> **A fonte da verdade é o código + o Swagger gerado dele.** Este documento é o mapa de
> navegação (o que existe, quem autentica o quê, por que o contrato é assim). Para o contrato
> exato de cada rota — parâmetros, schemas, exemplos — use o Swagger UI, que é gerado a partir
> dos decorators nos controllers e nunca sai de sincronia com a implementação.

Hoje são **90 operações em 86 paths, 18 controllers, 18 tags**. Os quatro paths que aparecem
duas vezes são leitura e escrita do mesmo recurso (`GET`/`POST /totems`, `GET`/`POST
/service-agents`, `GET`/`PUT /pixnopdv-store-credentials`, `GET`/`DELETE /ai/sessions`).

## Swagger / OpenAPI

| Item | Valor |
|---|---|
| Swagger UI | `http://localhost:<PORT>/api/v1/docs` |
| OpenAPI JSON | `http://localhost:<PORT>/api/v1/docs-json` |
| Raiz (`GET /`) | redireciona para `/api/v1/docs` |
| Prefixo global | `/api/v1` (`API_PREFIX`, definido em [main.ts](../src/main.ts)) |
| Porta padrão | `3010` (`PORT`) |
| Ligar/desligar | `SWAGGER_ENABLED` (default `true`) |
| Versão do documento | OpenAPI **3.0.0** · `info.version` = versão do `package.json` |

Configuração em [main.ts](../src/main.ts) (`setupSwagger`); helpers de decorator em
[common/swagger.ts](../src/common/swagger.ts).

Dois detalhes que **não devem ser alterados sem entender o efeito**:

- `addServer('/api/v1')` + `createDocument(..., { ignoreGlobalPrefix: true })` andam em par. O
  prefixo global do Nest não entra nos paths do documento automaticamente; ele é declarado uma
  única vez no `server`. Se você remover o `ignoreGlobalPrefix`, path e server passam a duplicar
  o prefixo e o **"Try it out" chama `/api/v1/api/v1/...` → 404**.
- `persistAuthorization: true` mantém o valor digitado no botão **Authorize** após reload.

O `helmet()` fica **antes** do Swagger e a UI funciona sob a CSP padrão dele: os assets
(`swagger-ui-bundle.js`, `swagger-ui-init.js`, `swagger-ui.css`) são servidos pela própria API
(`script-src 'self'`) e **não há script inline**. Se um dia a UI aparecer em branco, olhe o
console do browser antes de mexer na CSP.

### Validando o documento

```sh
curl -s http://localhost:3010/api/v1/docs-json -o openapi.json
npx @redocly/cli lint openapi.json
```

O resultado esperado hoje é **5 erros e 3 warnings — todos conhecidos e aceitos**:

- **`security-defined` (×5)** — as **cinco** rotas públicas de propósito: `GET /health`,
  `GET /health/live`, `POST /auth/login`, `POST /auth/logout` e `POST /auth/recovery-email`.
  Login não pode exigir a sessão que ele mesmo emite; logout precisa funcionar com sessão já
  morta (senão o cliente fica preso a um cookie inválido); recovery é anônimo por natureza.
  **Qualquer sexta rota nessa lista é bug** — é o jeito mais rápido de descobrir que alguém
  esqueceu um decorator ou pôs um `@Public()` a mais.
- **`operation-4xx-response` (×2)** — os dois health só documentam 200. Correto: eles não têm
  caminho de erro (não tocam banco).
- **`info-license`** — o pacote é `UNLICENSED` (software proprietário).

> ⚠️ **Esta lista já mentiu uma vez.** As cinco rotas `@ServiceOnly` de `/sync` e `/storage`
> subiram sem nenhum decorator de Swagger: apareciam no documento **sem security, sem summary e
> sem 4xx**, e o lint acusava dez `security-defined` em vez de cinco. Como ninguém rodava o
> lint, o número de cima é que passou a parecer errado. Se o `security-defined` vier acima de
> cinco, o problema é rota faltando decorator — não o parágrafo acima.
>
> Para conferir sem rede (o `npx` acima baixa o redocly), use o próprio JSON:
>
> ```sh
> node -e "const d=require('./openapi.json');for(const[p,i]of Object.entries(d.paths))for(const[m,o]of Object.entries(i))if(!o.security?.length)console.log(m.toUpperCase(),p)"
> ```

### Como testar uma rota no Swagger UI

1. Clique em **Authorize** e escolha o esquema que o cadeado da rota indica:
   - **`session-cookie`** → é `httpOnly`; o Swagger UI **não consegue** preenchê-lo por JS. Em
     vez disso, execute `POST /auth/login` **na própria UI** (mesma origem): o browser guarda o
     cookie e o manda sozinho nas chamadas seguintes.
   - **`session-bearer`** → cole o token opaco (é a MESMA sessão, em outro transporte). Útil
     para cliente que não é browser.
   - **`service-key`** → cole o `SERVICE_API_KEY` (rotas `@ServiceOnly`: `/tenants/provision`,
     `/sync/*` de fila e `/storage/*`).
2. Rotas de dado pedem **`X-Company-Id`** (e `X-Store-Id` onde a doc marcar obrigatório). Os
   headers aparecem no formulário da rota; sem eles o "Try it out" volta **400
   `company_required`**. Os ids saem de `GET /me/context` e `GET /me/stores`.

## Autenticação — 3 caminhos, 1 guard, 3 esquemas OpenAPI

Não há vários guards: existe **um** [`AuthGuard`](../src/common/guards/auth.guard.ts) global
(registrado como `APP_GUARD`) com ramos ordenados por metadado do decorator.

| Marcação na rota | Esquema OpenAPI | Credencial | Quem é o chamador |
|---|---|---|---|
| [`@Public()`](../src/common/decorators.ts) | *(nenhum)* | — | qualquer um |
| *(default, sem decorator)* | `session-cookie` **ou** `session-bearer` | cookie httpOnly `easyfood_session` **ou** `Authorization: Bearer <token opaco>` | usuário logado (browser/SPA) |
| [`@ServiceOnly()`](../src/common/decorators.ts) | `service-key` | header `X-Service-Key` = `SERVICE_API_KEY` | outro serviço (Sync-PG-SB) |

Notas de segurança que explicam o desenho:

- **O token de sessão é opaco, não JWT.** A API valida a senha contra o Supabase Auth
  server-side e emite um token aleatório próprio — o browser **nunca** recebe o JWT do
  Supabase. No banco fica só o `sha256(token)` (`hub_sessions`). Um token com `.` é rejeitado
  sem ir ao banco (discriminador barato: JWT tem ponto, base64url não).
- **Cookie e Bearer são a mesma sessão**, por isso aparecem como **duas alternativas** no
  documento (`security: [{session-cookie}, {session-bearer}]` = OR), não como duas exigências.
- **Fail-closed vira 503, não 401.** Se o banco de sessões falhar, a resposta é
  `503 service_unavailable` — um blip de infra não pode deslogar a frota inteira.
- **Sliding-expiry com throttle:** a validade é estendida quando a vida restante cai abaixo de
  `TTL − SESSION_RENEW_THROTTLE_MINUTES`, sem gerar token novo. Se veio do cookie, o guard
  reemite o cookie com a validade fresca.
- **Cache de sessão vem DESLIGADO** (`SESSION_CACHE_SECONDS`, default `0`) — ao contrário do
  cache de tenant. Ele é por-instância, então com mais de uma instância uma sessão revogada
  continuaria válida nas outras até o TTL vencer. Revogar sessão é resposta a incidente; o
  default correto em qualquer topologia é não cachear. Só ligue (ex.: `30`) em instância única.
- **`X-Service-Key` é comparado de forma timing-safe** (sobre o SHA-256 dos dois lados) e
  também aceita o mesmo valor via `Authorization: Bearer`.

## Isolamento de tenant — `X-Company-Id` / `X-Store-Id`

> ⚠️ **Esta seção dizia o contrário até setembro/2026.** Quando só existiam as 12 rotas
> migradas das edge functions, não havia header de tenant: a empresa saía da sessão. As rotas de
> dado (produtos, comandas, NFC-e, dispositivos, painel de sync) mudaram isso, e hoje o header é
> **obrigatório** na maioria das rotas. Se você leu "não existe `X-Company-Id`" em algum lugar,
> é texto velho.

Quem resolve é o [`TenantGuard`](../src/common/guards/tenant.guard.ts), global, rodando
**depois** do `AuthGuard`.

**Por que o tenant vem em header e não da sessão:** o Manager tem seletor de empresa/loja, e um
gestor abre duas lojas em duas abas. Com a loja ativa guardada na sessão do servidor, uma aba
mudaria a outra por baixo. O header faz cada requisição dizer por si de qual loja está falando.

**O header não é credencial — é ALVO.** O `userId` sai SEMPRE de `req.user` (posto pelo
`AuthGuard`); o header só passa depois de o banco confirmar o vínculo
(`has_company_access` para a empresa; para a loja, ser admin da empresa dona **ou** ter linha em
`pb_user_store_access`, com a loja não-apagada e pertencendo à empresa pedida). Apontar o header
para a empresa do vizinho dá **403**, não os dados dele.

**Falha fechado.** Rota nova **sem decorator já nasce exigindo `X-Company-Id`**. Escapar exige
declarar — o esquecimento vira 400 na cara do desenvolvedor, não vazamento silencioso entre
empresas:

| Decorator na rota | `X-Company-Id` | `X-Store-Id` |
|---|---|---|
| *(nenhum — default)* | obrigatório | opcional (se vier, é validado; senão `req.storeId = null`) |
| [`@RequireStore()`](../src/common/decorators.ts) | obrigatório | **obrigatório** |
| [`@SkipTenant()`](../src/common/decorators.ts) | dispensado | dispensado |
| `@ServiceOnly()` / `@Public()` | dispensado (o guard sai antes) | — |

Erros do guard: `400 company_required` · `400 invalid_company` · `400 store_required` ·
`400 invalid_store` · `403 forbidden` (mensagem genérica de propósito: distinguir "não existe"
de "não é membro" transformaria a rota num verificador de existência de empresa). Erro de banco
vira **503**, nunca 403 — infra instável não pode parecer falta de permissão.

**`@SkipTenant()` não é atalho para tirar o header do caminho.** Ele é legítimo em três casos, e
todos aparecem na tabela de endpoints:

1. a rota opera no contexto do **usuário**, não de uma empresa (`/auth/*`, `/me/context`,
   `/me/all-stores`, `/telemetry/error-report`);
2. o dado **não tem tenant** — é legislação, igual para todo mundo (`/cbs/*`, `/billing/plans`);
3. a rota recebe o `store_id` no **path/body** e faz a própria checagem de admin
   (`/stores/:storeId/bootstrap-code`, `/totems/tef-secrets/encrypt`).

Fora desses, rota sem tenant declarado que não prove de outro jeito o direito ao dado é
vazamento entre empresas.

**Cache:** `TENANT_CACHE_SECONDS` (default **30**, ligado). Conceder ou retirar acesso é ato
administrativo, não resposta a incidente — segundos de defasagem são aceitáveis, e sem cache
toda requisição pagaria uma ida extra ao banco só para autorizar. É o oposto do cache de sessão,
e de propósito.

### Autorização por loja (o que o tenant *não* garante)

Passar no `TenantGuard` quer dizer que a pessoa **pode usar** aquela loja. Duas rotas mexem com
material sensível e exigem mais — **administrar** a loja:

- `POST /stores/{storeId}/bootstrap-code`
- `POST /totems/tef-secrets/encrypt` — aqui a checagem é o que impede a rota de virar um
  **oráculo de cifragem**: a chave-mestra é compartilhada, então qualquer usuário logado poder
  cifrar texto arbitrário com ela seria um problema, não uma conveniência.

A regra vive num lugar só — [`pode-administrar-loja.ts`](../src/common/tenant/pode-administrar-loja.ts):
`system_admin`/`tech_admin` por papel, ou admin da empresa dona da loja por concessão. Ter acesso
à loja (`pb_user_store_access`) **não** basta.

> Isso já esteve errado em três dos quatro pontos de uso: todos chamavam
> `is_company_admin_for_store` sozinha, que exige linha em `pb_user_company_access` — e um
> `system_admin` não tem nenhuma, pois enxerga tudo por papel. Quem administrava o sistema levava
> 403 em toda tela com loja. O teste
> [`tenant-admin-coerencia.spec.ts`](../test/tenant-admin-coerencia.spec.ts) existe para o guard
> e a listagem não voltarem a divergir: tela que oferece o que o servidor recusa é o pior dos
> mundos.

### Por que a checagem em código é a ÚNICA barreira

O role do banco da API tem **`BYPASSRLS`** ([`sql/least-privilege-role.sql`](../sql/least-privilege-role.sql)),
de propósito: a API é a camada confiável que substitui o `authenticated` do navegador, e as
políticas RLS destas tabelas miram só o navegador. **Com a RLS fora do caminho, não há defesa em
profundidade** — o `where` explícito é a defesa. Três consequências que aparecem no código:

- as rotas filhas de NFC-e (`/nfce/notes/{noteId}/...`) conferem o vínculo **nota↔loja** antes de
  ler. No browser elas filtravam só por `note_id`, e quem barrava nota alheia era a RLS;
- as escritas de dispositivo levam o tenant **no `WHERE`**, não só o id — sete escritas do
  `cloud-data.ts` faziam `.update().eq("id", id)` e nada mais, o que aqui deixaria qualquer
  usuário logado desativar o agente de NFC-e de outra empresa e parar a emissão de nota dela;
- a contenção do role não é a RLS, é a **lista estreita de grants** (9 tabelas + 2 funções), mais
  não ser dono (sem DDL) nem superusuário, e não alcançar o schema `auth`.

## Envelope de erro — um formato só

O [`HttpExceptionFilter`](../src/common/filters/http-exception.filter.ts) global normaliza tudo:

```json
{ "error": "unauthorized", "message": "Sessão ausente. Faça login.", "statusCode": 401 }
```

`details` só aparece no **400 de validação Zod**, com um item por campo:

```json
{ "error": "invalid_input", "message": "Payload inválido.", "statusCode": 400,
  "details": [{ "path": "company", "message": "company.company_id ou company.cnpj é obrigatório" }] }
```

Códigos por status quando a exceção não traz um próprio: `400 bad_request` · `401 unauthorized`
· `403 forbidden` · `404 not_found` · demais `error` · `5xx internal_error`.

**Erro não tratado (não-`HttpException`) nunca vaza detalhe interno:** o stack/mensagem real vai
só para o log e o cliente recebe `{ error: "internal_error", message: "Erro interno." }`.

> **Quatro rotas que escapam do filtro** — todas escrevem na `Response` diretamente:
> - `POST /auth/recovery-email` → erro sai como `{ "error": "Email inválido" }` (sem
>   `message`/`statusCode`).
> - `POST /telemetry/error-report` → o corpo é o **do upstream**, repassado na íntegra; só o 502
>   de rede é montado aqui (`{ error, message }`, sem `statusCode`).
> - `POST /ai/chat` (SSE) e `GET /nfce/xml-archive` (ZIP) → **streaming**. Falha ANTES do primeiro
>   byte ainda sai no envelope normal; depois que o stream começou o status já foi enviado, então
>   o erro só pode ser registrado no log e a conexão, encerrada. Um download interrompido no meio
>   não tem como virar um JSON de erro — por isso o `_RESUMO.txt` do ZIP declara quantas notas
>   entraram, para o contador conferir que o pacote está completo.

## Convenções transversais

**Validação** é por rota com **Zod** (`ZodValidationPipe` + schemas em `contract/` e
`modules/*/dto/`) — **não** class-validator, e **não** há `ValidationPipe` global. Consequência
direta para a doc: como não há classes DTO com `@ApiProperty`, o Nest **não infere nada** dos
parâmetros. Todo `@Body`/`@Param`/`@Query` precisa de `@ApiBody`/`@ApiParam`/`@ApiQuery`
**explícito** — sem isso a rota aparece no Swagger sem nenhum parâmetro utilizável.

**Contrato do fio** em [`src/contract/`](../src/contract/README.md): os schemas que descrevem o
JSON que a UI espera, não as linhas do banco (`products` × `pv_products`). Dinheiro e quantidade
viajam como `number` — o driver `pg` devolve `numeric` como **string**, e a conversão é do
service, não da tela. Campo ausente é `null`, nunca `undefined` (que some no `JSON.stringify`).

**Rate-limit** global de **300 req/min**, contado por **SESSÃO**
([`SessionThrottlerGuard`](../src/common/guards/session-throttler.guard.ts), registrado **antes**
do `AuthGuard`: request abusiva não deve custar consulta). Contar por IP quebrava no uso real —
numa empresa todos saem pelo mesmo NAT, e o primeiro a abrir o dashboard derrubaria os colegas
com 429. Quem não tem sessão cai no IP; `POST /auth/login` e `POST /auth/recovery-email` apertam
para **10/min** e, sendo anônimas, contam por IP mesmo — que é o que se quer contra força bruta.
Estouro → **429**. Atrás de proxy, `trust proxy = 1` faz o IP sair do `X-Forwarded-For`.

**Controllers são finos** (EasyML §13): validam e delegam. Regra de negócio fica no service.

**Chokepoint `service_role`** (`ServiceRole.run(...)`): todo uso de privilégio elevado passa por
um ponto único e rotulado (`provision-tenant`, `auth-admin`, `auth-session`, `rbac-authz`,
`storage`). É **observabilidade, não controle de segurança** — ele não troca de role nem escopa
nada; serve para as escalações serem grepáveis e contáveis. Usuário do Supabase Auth é sempre
resolvido pela **portaria GoTrue (HTTPS)**, nunca lendo `auth.users` no Postgres — o role do
banco só toca `public.*`.

**Segredo que aparece uma vez** (API key de loja, senha temporária) não é recuperável depois: o
banco guarda `sha256` + prefixo. Nunca logue nem devolva o valor em claro fora da criação.

**Billing não vive aqui.** A API é *cliente* do billing (§10) — o teste
[`test/billing-boundary.guard.spec.ts`](../test/billing-boundary.guard.spec.ts) **quebra o build**
se alguém importar Stripe, escrever em `billing.*` ou chamar `functions.invoke`.

**IA não vive aqui.** `POST /ai/chat` é a porta do EasyFood para o navegador do EasyFood, mas o
miolo (provedor, prompt, base de conhecimento e **cobrança**) é do EasyAI (ADR-0003). Este módulo
já teve chave da OpenAI própria e escrevia nas MESMAS tabelas de cobrança da porta — duas réguas
na mesma carteira, com o cliente pagando diferente conforme o produto por onde entrasse. Se
`OPENAI_API_KEY`/`AI_MODEL`/`AI_DAILY_FREE_LIMIT` reaparecerem no `env.ts`, é sinal de que a IA
voltou a ser implementada aqui.

---

# Endpoints

**90 operações em 18 controllers.** Todos os paths abaixo são **relativos a `/api/v1`**.

Legenda da coluna **Tenant**: `loja` = `@RequireStore()` (exige `X-Company-Id` + `X-Store-Id`) ·
`empresa` = exige `X-Company-Id`, loja opcional · `—` = `@SkipTenant()` ou não se aplica.

## Health — [`health.controller.ts`](../src/modules/health/http/health.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `GET` | `/health` | pública | — | Health público mínimo: `{ status: "ok" }`. |
| `GET` | `/health/live` | pública | — | Liveness, mesmo corpo. |

Os dois **não tocam PG/Supabase de propósito**: o orquestrador/Docker usa `/health/live` para
decidir reinício, e um blip do banco não pode derrubar o container. São deliberadamente
minúsculos — nenhuma métrica interna (versão, contadores, estado de dependências) vaza numa
rota pública.

## Auth — [`auth.controller.ts`](../src/modules/auth/http/auth.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `POST` | `/auth/login` | pública (10/min) | — | Valida a senha no Supabase Auth e emite a sessão no cookie httpOnly. |
| `POST` | `/auth/logout` | pública | — | Revoga a sessão e limpa o cookie. |
| `GET` | `/auth/me` | sessão | — | `{ id, email }` do dono da sessão. |
| `POST` | `/auth/derived-session` | sessão | — | `token_hash` de magiclink para outro app do ecossistema. |
| `POST` | `/auth/sso/support` | sessão | — | Token HMAC + `redirect_url` para auto-login no Support. |
| `POST` | `/auth/recovery-email` | pública (10/min) | — | Dispara o e-mail de redefinição de senha. |

Particularidades que o nome da rota não conta:

- **`login` responde só `{ user }`.** O token **não** vai no corpo: se fosse, JS poderia lê-lo e
  o `httpOnly` perderia o sentido. Cliente não-browser lê o `Set-Cookie` e reusa o valor como
  `Authorization: Bearer`. Credencial errada → **401 genérico** (`invalid_credentials`), que não
  revela se o e-mail existe.
- **`logout` é público por necessidade**, não por descuido: uma sessão já expirada ainda precisa
  conseguir limpar o cookie. É idempotente (`{ ok: true }` mesmo sem sessão).
- **`derived-session`** gera o `token_hash` pelo Auth admin e **não envia e-mail nenhum** —
  o app derivado consome com `verifyOtp`. Validade de 1h. Quem identifica o chamador é a sessão
  da API, não um Bearer JWT do Supabase.
- **`sso/support`** tem **formato imutável** (contrato com o projeto Support):
  `base64url(json).base64url(hmac)`, payload `{ email, name, source_user_id, iat, exp, iss:
  "easycommandpay" }`, **exp de 120 segundos**. Sem nenhuma chave → 500
  `sso_not_configured` (fail-closed), nunca um token inválido. A chave é
  `SSO_SHARED_SECRET_EASYFOOD` (dedicada) com `SSO_SHARED_SECRET` (legada, compartilhada com os
  demais módulos Easy*) como **ponte** — a dedicada só passa a valer depois que a function `sso`
  do EasyChat for publicada aceitando-a (ver `docs/PROMPT-LOVABLE-sso-chave-easyfood.md`).
- **`recovery-email` responde 200 constante.** A entrega roda em *background*: mesmo corpo,
  status e **tempo**, exista ou não a conta — isso fecha enumeração por corpo, por status e por
  timing. O 400 só existe para erro de **formato**. O `redirect_to` passa por allowlist
  anti-open-redirect (só **https** e host `*.easysoftcloud.com.br`); sem ele, o destino vem do
  registro de apps pela chave `app` (hoje só `manager`).

## Contexto do usuário — [`me.controller.ts`](../src/modules/me/http/me.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `GET` | `/me/context` | sessão | — | Empresas e papéis do usuário logado. |
| `GET` | `/me/stores` | sessão | empresa | Lojas visíveis da empresa selecionada. |
| `GET` | `/me/all-stores` | sessão | — | Todas as lojas visíveis, de todas as empresas. |

**É a porta de entrada de toda sessão:** `/me/context` é `@SkipTenant()` porque é ela que diz
**quais** `X-Company-Id` existem para este usuário — exigir o header aqui seria circular.

Substitui o `CompanyStoreContext` do browser, que montava isso com 8 consultas diretas ao
Supabase e guardava a seleção no `localStorage`. A regra é a mesma, de propósito (a troca tem que
ser invisível): `system_admin`/`tech_admin` veem todas as empresas; os demais só as que têm em
`pb_user_company_access` com `status = 'approved'`. Admin vê todas as lojas da empresa; usuário
comum, só as de `pb_user_store_access`. Loja apagada não aparece para ninguém.

A diferença que importa: antes o `store_id` do filtro vinha do `localStorage` — o cliente
declarava em nome de quem agia. Agora a lista sai do banco, amarrada ao dono da sessão, e o
`TenantGuard` reconfere a cada requisição.

## Catálogo — [`catalog.controller.ts`](../src/modules/catalog/http/catalog.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `GET` | `/products` | sessão | loja | Produtos da loja. |
| `GET` | `/products/paged` | sessão | loja | Produtos paginados e filtrados **no banco**. |
| `GET` | `/products/{productId}/fiscal` | sessão | loja | Regra fiscal do produto. |
| `GET` | `/units` | sessão | empresa | Unidades de medida da empresa. |

`/units` é da **empresa**, não da loja, e isso não é descuido: unidade de medida é cadastro
compartilhado entre as lojas. Os filtros de `/products/paged` (`search`, `activeFilter`,
`stockFilter`, `priceMin/Max`, `sortKey/Dir`, `from`/`to`) mantêm os nomes que a tela já usava,
incluindo o par `from`/`to` de índices inclusivos — herança do `range()` do PostgREST, preservada
para a tela não ter que recalcular nada. Teto de **500 por página**.

## Operação — [`operations.controller.ts`](../src/modules/operations/http/operations.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `GET` | `/orders` | sessão | loja | Comandas da loja. |
| `GET` | `/order-items` | sessão | loja | Itens de comanda. |
| `GET` | `/transactions` | sessão | loja | Transações da loja. |
| `GET` | `/dashboard/stats` | sessão | loja | Números do topo do dashboard. |
| `GET` | `/dashboard/transactions-by-day` | sessão | loja | Transações por dia (últimos 7 dias). |
| `GET` | `/dashboard/revenue-approved` | sessão | loja | Receita aprovada — painel de faturamento. |
| `GET` | `/dashboard/sync-by-hour` | sessão | loja | Sempre vazio na nuvem (metadado é da loja). |

`from`/`to` são `YYYY-MM-DD` **inclusivos**, recortados por dia civil no **fuso do banco** —
igual à Admin-API da loja. No browser o corte usava o fuso de quem estava olhando a tela; a
mudança faz as duas implementações concordarem entre si.

## NFC-e — [`nfce.controller.ts`](../src/modules/nfce/http/nfce.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `GET` | `/nfce/attention-counts` | sessão | loja | Contadores dos cards de atenção. |
| `GET` | `/nfce/notes` | sessão | loja | Notas da loja, paginadas. |
| `GET` | `/nfce/totals` | sessão | loja | Totais dos cards, do **período** inteiro. |
| `GET` | `/nfce/xml-archive` | sessão | loja | Baixa os XML do filtro num **ZIP**. |
| `GET` | `/nfce/issuer-config` | sessão | loja | Configuração do emitente (dados fiscais da loja). |
| `GET` | `/nfce/notes/{noteId}` | sessão | loja | Detalhe da nota. |
| `GET` | `/nfce/notes/{noteId}/items` | sessão | loja | Itens da nota, com os impostos. |
| `GET` | `/nfce/notes/{noteId}/payments` | sessão | loja | Pagamentos da nota. |
| `GET` | `/nfce/notes/{noteId}/logs` | sessão | loja | Histórico técnico da nota. |
| `GET` | `/nfce/notes/{noteId}/events` | sessão | loja | Eventos fiscais (cancelamento, carta de correção). |

- **Toda rota filha confere o vínculo nota↔loja** antes de ler, e nota de outra loja devolve
  **lista vazia, não 404** — responder diferente transformaria a rota num verificador de
  existência de documento fiscal alheio. É aqui que está o ganho de segurança da migração: no
  browser essas consultas filtravam só por `note_id` e quem barrava era a RLS.
- **`/totals` soma o PERÍODO, não a página carregada.** Os cards do topo ficavam errados quando a
  lista era paginada — foi a correção de `d009e37`.
- **`/xml-archive` monta o ZIP em streaming**, lendo o banco em lotes de 200 notas e empurrando
  cada arquivo para a resposta. Um mês de loja movimentada passa de 30 mil notas (~4-8 KB de XML
  cada); carregar tudo em memória derrubaria a API **para todas as lojas**, não só para quem
  clicou. **Não há teto de notas, de propósito** — quem recorta é o filtro da tela, e só ele: um
  teto cortaria o pacote sem o usuário pedir, e o contador entregaria a escrituração achando que
  exportou o período inteiro. O `_RESUMO.txt` declara filtros aplicados e contagens.

## CBS / IBS (referência fiscal) — [`cbs.controller.ts`](../src/modules/cbs/http/cbs.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `GET` | `/cbs/open-dataset-version` | sessão | — | Sempre `[]` na nuvem (metadado é da loja). |
| `GET` | `/cbs/municipality-by-uf` | sessão | — | Municípios de uma UF (`uf` obrigatório). |
| `GET` | `/cbs/municipality-with-rate-by-uf` | sessão | — | Municípios da UF **com** as alíquotas. |
| `GET` | `/cbs/product-fiscal-ibscbs` | sessão | — | Classificação tributária + indicadores de UM código. |
| `GET` | `/cbs/{key}` | sessão | — | Tabela de referência, resolvida pelo catálogo (**14 chaves**). |

**`@SkipTenant()` em tudo, e isso é decisão, não esquecimento:** não existe `store_id` nem
`company_id` em nenhuma destas tabelas — é legislação, igual para todas as empresas. Exigir
`X-Company-Id` para ler a tabela de UFs seria teatro de segurança. A sessão continua obrigatória.

As tabelas simples são servidas por **um handler só**, dirigido pelo catálogo em
[`cbs.catalog.ts`](../src/modules/cbs/infrastructure/cbs.catalog.ts): rota nova = uma entrada no catálogo, não
um método novo. As **14 chaves** aceitas hoje em `/cbs/{key}` — o Swagger mostra o parâmetro
livre, então a lista vive aqui e no catálogo:

```
cst-ibscbs                    tax-class-ibscbs              state
cst-ibscbs-indicator          tax-class-ibscbs-indicator    state-reference-rate
cst-selective-tax             tax-class-ibscbs-type         union-reference-rate
selective-tax-ncm             tax-class-selective-tax       municipality-reference-rate
legal-basis                   presumed-credit-rule
```

> A contagem autoritativa é `CBS_CATALOG.length`. Ela já esteve escrita como **19** no catálogo e
> **15** no controller, com 14 entradas no array — por isso o número acima não deve ser repetido
> em prosa sem conferir.

`municipality-by-uf` **exige** a UF e não tem variante "traz tudo": `pb_cities`
tem 5.573 registros, e a tela que puxasse o Brasil inteiro travaria o navegador antes de
incomodar o banco. `municipality-with-rate-by-uf` devolve **uma linha por (município × data de
referência)**, não só a mais recente — a tela filtra por ano, e trazer só a última faria 2025 vir
vazio.

## Dispositivos (leitura) — [`devices.controller.ts`](../src/modules/devices/http/devices.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `GET` | `/totems` | sessão | empresa | Configuração dos totens da empresa. |
| `GET` | `/totem-licenses` | sessão | empresa | Licenças de totem da empresa. |
| `GET` | `/totem-available-licenses` | sessão | empresa | Licenças que a tela pode oferecer a um totem. |
| `GET` | `/service-agents` | sessão | empresa | Agentes de NFC-e da empresa. |
| `GET` | `/service-agents/{agentId}/audit-logs` | sessão | empresa | Histórico de alterações de um agente. |
| `GET` | `/totems/{totemId}/audit-logs` | sessão | empresa | Histórico de alterações de um totem. |
| `GET` | `/audit-logs` | sessão | empresa | Auditoria unificada — totens e agentes na mesma linha do tempo. |
| `GET` | `/pixnopdv-store-credentials` | sessão | loja | Credenciais do PIXnoPDV (produção). |
| `GET` | `/product-images` | sessão | loja | Imagens de produto por id. |

`/totem-available-licenses` devolve as livres (`status = active` e `totem_config_id` nulo)
**mais a que já está vinculada** ao totem passado em `?totemId=`. Informe o `totemId` sempre que
estiver **editando** um totem: sem ele, um totem que já consome a única licença da empresa recebe
lista vazia, e a tela não mostra nem a licença atual nem opção de troca — era esse o bug de
`6f18a27` ("a licença vinculada sumia da tela de edição").

## Dispositivos (escrita) — [`devices-write.controller.ts`](../src/modules/devices/http/devices-write.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `POST` | `/totems` | sessão | empresa | Cria a configuração de um totem. |
| `PATCH` | `/totems/{totemId}` | sessão | empresa | Edita a configuração de um totem. |
| `PATCH` | `/totems/{totemId}/active` | sessão | empresa | Ativa ou desativa um totem. |
| `POST` | `/totems/{totemId}/requeue-cloud-sync` | sessão | empresa | Reenfileira a sincronização do totem. |
| `POST` | `/service-agents` | sessão | empresa | Cria um agente de NFC-e. |
| `PATCH` | `/service-agents/{agentId}` | sessão | empresa | Edita um agente de NFC-e. |
| `PATCH` | `/service-agents/{agentId}/active` | sessão | empresa | Ativa ou desativa um agente de NFC-e. |
| `PUT` | `/pixnopdv-store-credentials` | sessão | loja | Salva as credenciais do PIXnoPDV. |

- **O tenant vem da sessão, nunca do corpo.** O navegador manda a empresa no payload; aceitar
  isso deixaria o cliente escolher em nome de quem grava.
- **O comando leva o tenant no `WHERE`**, não só o id — dispositivo de outra empresa devolve
  **403 sem escrever nada**. Ver ["a checagem em código é a única barreira"](#por-que-a-checagem-em-código-é-a-única-barreira).
- **Regra de licença: demo não opera em produção**
  ([`totem-license.rule.ts`](../src/modules/devices/domain/totem-license.rule.ts)). Uma regra com três
  gatilhos (`app_mode = 'producao'`, `payment_environment` de produção, `nfce_environment = 1`) —
  no `cloud-data.ts` eram três funções fazendo a mesma pergunta. Não é limite comercial: é o que
  impede uma instalação de teste de emitir NFC-e **real** na SEFAZ. `plan_slug` preenchido decide
  sozinho (plano que não seja `ecp-demo` é licença real, mesmo com `license_type = 'monthly'`) —
  inverter a ordem faria licença paga mensal bloquear produção sem motivo.

## Painel de sync — [`sync-panel.controller.ts`](../src/modules/sync-panel/http/sync-panel.controller.ts)

**17 rotas**, todas `GET`, sessão, tenant = **empresa** (loja opcional — sem ela o painel mostra
a empresa inteira). Simétricas entre as duas filas:

| Sufixo | `/sync/inbox/…` (recebido da loja) | `/sync/outbox/…` (a enviar para a loja) |
|---|---|---|
| `summary` | ✓ contagem por situação | ✓ |
| `by-entity` | ✓ volume por tipo de entidade | ✓ |
| `failures-by-error` | ✓ falhas agrupadas por erro | ✓ |
| `backlog` | ✓ acumulado e idade do mais antigo | ✓ |
| `active-retries` | ✓ em retentativa agora | ✓ |
| `recent-failures` | ✓ últimas falhas | ✓ |
| `recent-all` | ✓ movimento recente, paginado | ✓ |
| `apply-rate` / `dispatch-rate` | ✓ ritmo de aplicação | ✓ ritmo de despacho |
| `recent-applied` | ✓ últimos aplicados | — (não existe do lado outbox) |

As 17 são declaradas no catálogo ([`sync-panel.catalog.ts`](../src/modules/sync-panel/domain/sync-panel.catalog.ts))
e registradas por **um handler só**. Os paths são os **mesmos** que a Admin-API da loja serve: um
contrato, duas implementações.

> ⚠️ Estas rotas dividem o prefixo `/sync` com a [fila máquina-a-máquina](#fila-de-sync-máquina-a-máquina--synccontrollerts).
> O que as separa é o sufixo do path **e a auth** (sessão aqui, `X-Service-Key` lá). Ao criar rota
> em qualquer um dos dois controllers, confira que o path novo não existe no outro: o Nest
> registra o primeiro que encontrar e o segundo vira rota morta, sem erro no boot.

**Desempenho:** o painel chegou a levar **67 s** para abrir. A causa era falta de índice por
tenant na `ecb_sync.inbox` (~3,8 milhões de linhas); `fb2c4b0` levou para menos de 1 s. O script
[`indices-sync-inbox.mjs`](../scripts/indices-sync-inbox.mjs) é o que cria esses índices — e é o
**único script que escreve no banco** (rode com `SO_MEDIR=1` primeiro para ver o que ele faria).

## Billing — [`billing.controller.ts`](../src/modules/billing/http/billing.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `GET` | `/billing/credits` | sessão | loja | Transações de crédito de IA da loja. |
| `GET` | `/billing/usage` | sessão | loja | Log de uso de IA da loja. |
| `GET` | `/billing/license` | sessão | empresa | Estado da licença da empresa. |
| `GET` | `/billing/plan-window` | sessão | empresa | Janela de histórico permitida pelo plano. |
| `GET` | `/billing/plans` | sessão | — | Catálogo de planos ativos do produto. |

**Só leitura — esta API não cobra nada.** O recorte segue o dado: crédito e uso de IA são **por
loja** (desde a migração de 2026-05-14, `credit_transactions.store_id`) — `company_id` sozinho
devolveria o crédito das outras lojas da mesma empresa. Licença é da **empresa**. Catálogo de
planos é do **produto**, e por isso `@SkipTenant()`.

Antes o browser lia `billing.*` direto pelo PostgREST, com um segundo cliente Supabase só para
esse schema e a RLS como única barreira. Agora quem lê é a API, com `where` explícito sobre o
valor que o `TenantGuard` já validou.

> **Divergência deliberada com o EasyML:** ele filtra `company_licenses`/`license_history` por
> `module = 'easyml'`. Aqui **não** se filtra por módulo, porque é o que o Manager-Web faz hoje
> (pega a licença mais recente da empresa, de qualquer módulo). Acrescentar o filtro mudaria o
> plano exibido para quem tem licença de mais de um produto Easy* — é decisão de produto, não
> detalhe de migração. Quando for tomada, o lugar é `BillingService` e a constante
> `BILLING_MODULE` já existe.

## Assistente IA — [`ai.controller.ts`](../src/modules/ai/http/ai.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `POST` | `/ai/chat` | sessão | loja | Conversa com o assistente (**SSE**). |
| `GET` | `/ai/sessions` | sessão | empresa | Histórico de conversas da empresa. |
| `PUT` | `/ai/sessions/today` | sessão | empresa | Grava (ou apaga) a conversa de hoje. |
| `DELETE` | `/ai/sessions/{sessionId}` | sessão | empresa | Apaga uma conversa do histórico. |
| `DELETE` | `/ai/sessions` | sessão | empresa | Limpa o histórico do usuário (preserva a de hoje). |

O chat exige **loja** porque a cota grátis e o crédito são por loja: sem saber de qual loja se
fala, não há como contar nem cobrar. O histórico é da **empresa** — qualquer membro aprovado lê,
só o autor apaga.

- **A IA não é executada aqui.** A rota encaminha ao EasyAI (ADR-0003), dono da credencial, do
  prompt, da base de conhecimento e da cobrança. A resposta é `text/event-stream` no formato de
  `chat/completions`, repassada **sem bufferizar** — bufferizar faria o texto aparecer de uma vez
  na tela.
- **Empresa e loja não vêm no corpo:** saem do `TenantGuard` e são enviadas ao EasyAI, que as
  reconfere contra o vínculo real. O `company_id` **não** entra no token de serviço — a confiança
  que damos é sobre **quem** é o usuário, não sobre **o que** ele pode, para que um
  comprometimento desta API não vire débito em empresa alheia.
- **Auth para lá:** `X-Service-Token` HMAC-SHA256 (`AI_SERVICE_SHARED_SECRET`, exp de 120 s) —
  repassar o header do usuário não funcionaria, porque a sessão daqui é token **opaco**, que o
  EasyAI não sabe validar. Sem o segredo → **503 `ai_not_configured`** (fail-closed explícito, em
  vez de erro genérico que pareceria problema de rede).
- **Cobrança é do outro lado, e só depois da resposta existir.** Aqui não há o que contabilizar.

## Telemetria — [`telemetry.controller.ts`](../src/modules/telemetry/http/telemetry.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `POST` | `/telemetry/error-report` | sessão | — | Repassa o relatório ao EasyGuardian injetando `x-report-secret` server-side. |

O corpo é **opaco** (o schema é do EasyGuardian). Duas travas na borda: precisa ser um **objeto**
JSON e no máximo **64 KB** serializado — a API não vira relay de payload arbitrário. Exige sessão
justamente para bloquear spam anônimo. Status e corpo do upstream são repassados na íntegra;
resposta não-JSON vira `{ raw }`; upstream inalcançável → **502** `upstream_unreachable`.

Sem `ERROR_REPORT_SECRET` no ambiente → **503** `telemetry_not_configured`, com `warn` no log e
**sem** chamada ao upstream. É fail-closed de propósito: o EasyGuardian responde 401 a header
vazio e o browser reporta em fire-and-forget (`.catch(() => {})`) — mandar assim perderia todo
relatório em silêncio, que foi o estado da produção até 31/07/2026.

## Totens — [`totems.controller.ts`](../src/modules/totems/http/totems.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `POST` | `/totems/tef-secrets/encrypt` | sessão + **admin da loja** | — (`store_id` no corpo) | Cifra os segredos TEF (Aditum) no envelope `enc:v1`. |

Formato do envelope: `enc:v1:<iv_b64>:<tag_b64>:<data_b64>` (**AES-256-GCM**, IV de 12 bytes) — o
**mesmo** que o Electron/totem decifra. A rota **não grava nada**: devolve o texto cifrado e o
`kid` (guarde os dois juntos, para permitir rotação de chave depois). Campo vazio/nulo/só-espaços
→ o par `*_encrypted`/`*_kid` volta `null`. Master key ausente ou com tamanho ≠ 32 bytes → **500**
(`not_configured` / `bad_key`), nunca cifra com chave fraca.

## Lojas — [`stores.controller.ts`](../src/modules/stores/http/stores.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `POST` | `/stores/{storeId}/bootstrap-code` | sessão + **admin da loja** | — (`storeId` no path) | Emite o código de primeiro acesso da loja. |

**Formato imutável** (contrato byte-a-byte com a Admin-API local):

```
code    = "EFB1.<b64url(json)>.<b64url(hmacSha256)>"
key     = HKDF-SHA256(ikm=master, salt=vazio, info="easyfood/bootstrap-code/v1", 32B)
payload = { v: 1, em, sid, exp, jti }
```

O código é **auto-contido e verificado offline** pela loja — é assim que uma instalação nova se
configura mesmo com internet instável. Nada é gravado no banco (não há como reemitir "o mesmo"
código; emita outro). `ttl_hours`: default **48h**, teto **72h** (valor maior é silenciosamente
reduzido; ausente/zero/não-numérico cai no default). `storeId` fora do formato UUID → 400
`invalid_store`.

## Tenants (máquina-a-máquina) — [`tenants.controller.ts`](../src/modules/tenants/http/tenants.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `POST` | `/tenants/provision` | `X-Service-Key` | — | Provisiona empresa + lojas + usuários + API key. |

Chamado pelo **Sync-PG-SB** (`ProvisionTenantFromNfceIssuerJob`), nunca pelo browser. O contrato
de entrada foi mantido idêntico ao da edge function `provision-tenant` para não quebrar o cliente.

- **Idempotência por identidade, não por repetição.** Empresa: `company_id` → `cnpj` → insert.
  Loja: `store_id` → `cnpj` (sempre **dentro da empresa** resolvida) → insert. O campo
  `id_resolution` da resposta diz qual caminho foi usado (`client_provided_match` |
  `matched_by_cnpj` | `newly_created`). Reenviar o mesmo payload **atualiza**, não duplica.
- **Atomicidade parcial — leia com atenção.** Empresa → lojas → perfis/roles/acessos → API key
  rodam em **uma transação**. Mas os usuários são resolvidos/criados no **Supabase Auth ANTES**
  dela (via GoTrue admin): um rollback **não** desfaz o usuário criado no Auth. Isso é seguro
  para reexecução (a próxima chamada reaproveita o usuário existente), mas não é "tudo ou nada"
  de ponta a ponta.
- **Segredos que aparecem uma única vez:** `api_key` (só quando `api_key_status = "created"`; se
  já havia chave ativa vem `null` + status `existente`, e a chave antiga **não** é revelada) e
  `temporary_password` (só para usuário recém-criado). O banco guarda `sha256` + prefixo.
- `legacy_store_code` omitido no insert → `max(legacy_store_code) + 1` **dentro da empresa**.
  CNPJ com 14 dígitos é reformatado para `00.000.000/0000-00`.
- Os **triggers do banco** (outbox p/ POS, estoque, seed, auditoria) continuam disparando
  sozinhos — o provisionamento não os replica em código.

## Fila de sync (máquina-a-máquina) — [`sync.controller.ts`](../src/modules/sync/http/sync.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `GET` | `/sync/outbox/pending` | `X-Service-Key` | — | Pull: eventos ainda não despachados. |
| `POST` | `/sync/inbox` | `X-Service-Key` | — | Push: entrega um lote na inbox (idempotente). |
| `POST` | `/sync/outbox/dispatched` | `X-Service-Key` | — | Ack: marca despachados os eventos. |

Camada 1b do cutover: substitui o acesso pg direto/PostgREST do worker das lojas, replicando
**fielmente** o que o `PgRemoteSupabaseSyncAdapter` fazia — mesma ordenação (`changed_at,
event_id`), mesmo filtro de tenant (com o **NIL UUID** como broadcast) e a mesma idempotência
(`ON CONFLICT (event_id) DO NOTHING`).

Três detalhes que o nome não conta, e que fazem o worker parecer quebrado se ignorados:

- `limit=0` é **válido** e devolve lista vazia — é o *connectivity check* do worker.
- `received` conta o lote **enviado**, não o gravado: um lote inteiramente já conhecido responde o
  mesmo número. Quem quiser saber o que entrou olha a inbox.
- `updated` pode vir **menor** que a quantidade de ids do ack — é ack repetido, não erro. O
  `WHERE` só toca o que ainda estava `pending`, para `dispatched_at` continuar sendo o carimbo da
  entrega de verdade.

Teto de **5000** linhas/ids por chamada.

## Storage (máquina-a-máquina) — [`storage.controller.ts`](../src/modules/storage/http/storage.controller.ts)

| Método | Path | Auth | Tenant | O que faz |
|---|---|---|---|---|
| `POST` | `/storage/product-images` | `X-Service-Key` | — | Sobe imagem de produto; devolve a URL pública. |
| `POST` | `/storage/nfce-certificates` | `X-Service-Key` | — | Sobe o PFX da NFC-e; devolve o object path. |

Fase 2 do cutover: o SDK do Supabase (e a chave de Storage) saem das lojas. O trabalho **local**
— achar o arquivo, baixar da LAN, ler os bytes — continua na loja; só o upload sobe para cá, por
`multipart/form-data`, e a API grava com a service_role pelo chokepoint `storage`. Paths e limites
idênticos aos do SDK antigo.

O certificado devolve **object path, não URL pública**, e a diferença é de propósito: um PFX é a
identidade fiscal da empresa — quem o tem assina nota em nome dela, então o bucket é privado. A
**senha do certificado não passa por esta rota**.

Dois tetos que não são redundantes: o multer corta em **25 MB** (backstop, antes de o buffer
existir, protegendo a memória do processo) e o service recusa acima de **20 MB** para imagem e
**5 MB** para PFX (o contrato). Erro do Storage vira **400**, não 500 — quem chama é um serviço, e
bucket inexistente ou permissão faltando é problema da chamada.

---

## Ao adicionar uma rota nova

O Swagger só é bom enquanto os decorators acompanharem o código — e as cinco rotas `@ServiceOnly`
que ficaram meses sem nenhum decorator são a prova de que isso não se cuida sozinho. Checklist:

1. `@ApiTags("<Domínio>")` no controller (reaproveite uma tag existente).
2. O helper de auth conforme a marcação da rota — de
   [common/swagger.ts](../src/common/swagger.ts):
   - default (sessão) → `@ApiSessionAuth()` no controller;
   - `@ServiceOnly()` → `@ApiServiceKeyAuth()` no controller;
   - `@Public()` → **nenhum** (e conte que o `security-defined` do redocly vai subir para 6 —
     confirme que a rota é mesmo pública antes de aceitar).
3. **Decida o tenant, não deixe acontecer.** Rota de dado de uma loja → `@RequireStore()` +
   `@ApiTenantHeaders(true)`. De empresa → só `@ApiTenantHeaders()`. Sem tenant → `@SkipTenant()`
   **e** um motivo que caiba nos três casos legítimos da seção de isolamento. Sem o
   `@ApiTenantHeaders`, a rota funciona mas aparece no Swagger sem os headers, e quem testar pelo
   "Try it out" leva 400 sem entender por quê.
4. `@ApiOperation({ summary, description })` — o `description` explica o comportamento **real**
   (idempotência, formato imutável, fail-closed, o que NÃO é gravado), não repete o nome da rota.
5. **Um `@ApiBody`/`@ApiParam`/`@ApiQuery` para cada parâmetro.** Zod não gera doc — sem isso o
   parâmetro simplesmente **não existe** no Swagger UI.
6. Erros: `@ApiSessionErrorResponses()` (401+429+503+500) ou `@ApiServiceKeyErrorResponses()`,
   mais o `@ApiResponse` de sucesso e os específicos (403, 404…).
   ⚠️ **Um `@ApiResponse` por status.** Se a rota precisa de um 401/500 com códigos próprios,
   troque o bloco pronto por `@ApiSessionUnauthorizedResponse([...])` +
   `@ApiSessionInfraErrorResponses()` + o seu `@ApiResponse` — duplicar o mesmo status faz um
   sobrescrever o outro em silêncio.
7. Registre o módulo em [app.module.ts](../src/app.module.ts).
8. `npm run typecheck && npm run build && npm test`, suba a API e confira em `/api/v1/docs` —
   inclusive o **cadeado** e os **headers** da rota nova, não só o corpo.
9. Atualize a contagem no topo deste arquivo e a tabela da seção do domínio.

**Nunca** use CPF/CNPJ real, e-mail de cliente ou uma chave/segredo plausível em `example` —
placeholders óbvios (LGPD).
