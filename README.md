# EasyFood API

Camada 2 (API de aplicação) do EasyFood — a **única porta** para o Supabase cloud,
no padrão de 3 camadas do EasyML. Substitui as Edge Functions e o acesso direto ao
banco na nuvem.

> Status: **90 rotas em 18 controllers** — provisionamento, login/sessão, as telas do
> Manager-Web (catálogo, operação, NFC-e, dispositivos, painel de sync, billing, IA) e as
> rotas máquina-a-máquina da fila de sync e do Storage. NestJS 10, TypeScript.

## Rodar (dev)

```bash
npm install
cp .env.example .env      # preencher SERVICE_API_KEY, SUPABASE_URL, SERVICE_ROLE, DATABASE_URL
npm run dev               # nest start --watch  (http://localhost:3010)
npm run typecheck         # tsc --noEmit
npm run lint              # eslint (0 erros, 0 avisos — inclui as regras de camada)
npm test                  # vitest (inclui o guard de fronteira de billing)
npm run contract:check    # compila e confere o contrato HTTP contra o snapshot
```

> O `lint` roda no CI junto do typecheck e passa **limpo**. `any` é erro, e um import que
> fure as camadas dos módulos também (regras em [eslint.config.mjs](eslint.config.mjs)).
>
> O `contract:check` sobe a aplicação compilada sem abrir porta e sem tocar o banco, e
> compara rotas, marcas de segurança (`@Public`, `@ServiceOnly`, `@SkipTenant`,
> `@RequireStore`, rate-limit), a ordem dos guards globais e o OpenAPI com
> [test/contrato/contrato-http.snapshot.json](test/contrato/contrato-http.snapshot.json).
> Refatoração não muda esse arquivo; mudança de contrato intencional regrava com
> `npm run contract:update` — e o diff do snapshot é o que o revisor lê.

⚠️ Ao testar, aponte o `.env` para **HOMOLOG**. O `DATABASE_URL` de homolog costuma
ser o **pooler** (`...pooler.supabase.com`; o host `db.<ref>` não resolve).

## Documentação da API (Swagger)

| Item | Valor |
|---|---|
| Swagger UI | `http://localhost:3010/api/v1/docs` |
| OpenAPI JSON | `http://localhost:3010/api/v1/docs-json` |
| Raiz (`GET /`) | redireciona para a doc |
| Ligar/desligar | `SWAGGER_ENABLED` (default `true`) |

O documento é gerado **dos decorators dos controllers** em runtime — não existe arquivo
de spec para manter em sincronia. Mapeamento detalhado (quem autentica o quê, por que
cada contrato é assim, checklist de rota nova): [docs/api-endpoints.md](docs/api-endpoints.md).

Para testar com sessão no Swagger UI: o cookie é `httpOnly`, então rode `POST /auth/login`
**na própria UI** (mesma origem) — o browser passa a enviar o cookie sozinho. Cliente
não-browser usa o esquema `session-bearer` com o mesmo token.

## Rotas

Um resumo por domínio; o inventário rota a rota (com o porquê de cada contrato) está em
[docs/api-endpoints.md](docs/api-endpoints.md), e o contrato exato no Swagger gerado do código.
Todos os paths são relativos a `/api/v1`.

| Domínio | Rotas | Auth | Tenant |
|---|---|---|---|
| `health` | 2 | pública | — |
| `auth` | 6 | pública (login/logout/recovery) · sessão (resto) | — |
| `me` (contexto) | 3 | sessão | empresa em `/me/stores` |
| `catalog` (produtos, unidades) | 4 | sessão | loja (empresa em `/units`) |
| `operations` (comandas, dashboard) | 7 | sessão | loja |
| `nfce` (notas, XML em ZIP) | 10 | sessão | loja |
| `cbs` (referência fiscal) | 5 | sessão | — (é legislação, não tem tenant) |
| `devices` (leitura / escrita) | 9 + 8 | sessão | empresa · loja no PIXnoPDV e imagens |
| `sync-panel` (monitor) | 17 | sessão | empresa (loja opcional) |
| `billing` (só leitura) | 5 | sessão | loja · empresa · — |
| `ai` (chat + histórico) | 5 | sessão | loja no chat, empresa no histórico |
| `telemetry` | 1 | sessão | — |
| `totems` · `stores` | 1 + 1 | sessão + **admin da loja** | — (id no path/body) |
| `tenants` · `sync` (fila) · `storage` | 1 + 3 + 2 | **X-Service-Key** | — |

Duas fronteiras que o build defende sozinho:

- **Billing não vive aqui** (`create-checkout`, `stripe-webhook`): a API é **cliente** do
  billing (§10) e só LÊ crédito/licença. `test/billing-boundary.guard.spec.ts` quebra o build
  se alguém trouxer Stripe, escrita em `billing.*` ou `functions.invoke` pra dentro.
- **IA não vive aqui**: `POST /ai/chat` é nossa, o miolo é do **EasyAI** (ADR-0003). Se
  `OPENAI_API_KEY`/`AI_MODEL`/`AI_DAILY_FREE_LIMIT` reaparecerem no `env.ts`, a IA voltou a ser
  implementada aqui — e voltaram as duas réguas cobrando da mesma carteira.

## Auth

- **Usuário (browser):** `POST /auth/login` valida a senha no Supabase Auth e emite um
  **token opaco** num **cookie httpOnly** (sessões em `hub_sessions`, só o `sha256`).
  Sliding-expiry + cache + fail-closed (erro de banco = 503).
- **Máquina-a-máquina:** header **`X-Service-Key`** = `SERVICE_API_KEY` (rotas `@ServiceOnly`).

**Tenant vai em header, e não é credencial.** As rotas de dado exigem `X-Company-Id` (e
`X-Store-Id` onde a loja é obrigatória): o header é **alvo**, e o `TenantGuard` confere o
vínculo no banco antes de deixar passar — apontar para a empresa do vizinho dá **403**. Vai em
header, e não na sessão, porque o Manager tem seletor de loja e um gestor abre duas lojas em
duas abas; com a loja ativa guardada no servidor, uma aba mudaria a outra por baixo.

O guard **falha fechado**: rota nova sem decorator já nasce exigindo tenant, e escapar disso
exige declarar `@SkipTenant()`. O esquecimento vira 400 na cara do desenvolvedor, não vazamento
silencioso entre empresas — o que importa porque o role do banco tem `BYPASSRLS` de propósito
(a API é a camada confiável que substitui o `authenticated` do browser), e com a RLS fora do
caminho **a checagem em código é a única barreira**, não defesa em profundidade.

## Deploy

```bash
docker compose up --build       # smoke local a partir do .env
# ou:
docker build -t easyfood-api .
docker run -p 3010:3010 --env-file .env easyfood-api
```

- **Env do cofre, não do `.env`** (padrão EasyML/ADR-0012): em produção o env vem do
  **Infisical** → `api.env` (600) no servidor → processo. Nunca commitar segredo.
- **Health:** `GET /api/v1/health/live` (não depende de PG — seguro pra orquestrador).
- **Role do banco:** idealmente um role de **menor privilégio** com `EXECUTE`/DML só no
  necessário (não `postgres`). O `DATABASE_URL` aponta pra ele.

### 🔒 TLS do banco em produção (`DATABASE_CA_CERT`)

Sem CA, a conexão é **criptografada mas não confere a identidade** do servidor — brecha
teórica de "homem no meio". Em **produção**, forneça o CA para verificar (o boot loga qual
estado está ativo: `TLS do banco: verificação de certificado LIGADA/DESLIGADA`).

1. **Escolha o host** do `DATABASE_URL`:
   - **Direto** `db.<ref>.supabase.co` → valida com o CA do painel (exige **IPv6**). **Preferir.**
   - **Pooler** `...pooler.supabase.com` → funciona com IPv4, mas usa **outro CA** (o da cadeia do pooler).
2. **Baixe o CA** correspondente (painel: *Database → SSL configuration → Download certificate*, para o host direto).
3. Cole o PEM em **`DATABASE_CA_CERT`** (com `\n` nas quebras) e deixe `DATABASE_SSL_REJECT_UNAUTHORIZED=true`.
4. **Prove no deploy:** confirme o log "verificação LIGADA" **e** que um CA errado é **RECUSADO**
   (senão está só criptografado, confiando em qualquer um).

> Homolog roda hoje com `DATABASE_SSL_REJECT_UNAUTHORIZED=false` (cert do pooler é auto-assinado).
> Isso é aceitável fora de produção; em produção o boot emite **erro** se ficar desligado.

### ⚠️ Decisão de mesma-origem (cookie)

O cookie de sessão é `httpOnly`. Onde a **SPA** (Manager-Web) e a **API** rodam?

- **Mesma origem** (ex.: SPA e API atrás do mesmo domínio, API em `/api`): use
  `SESSION_COOKIE_SAMESITE=lax` (default). Sem CORS com credenciais. **Recomendado.**
- **Origens diferentes:** `SESSION_COOKIE_SAMESITE=none` (exige HTTPS/`Secure`) +
  `CORS_ORIGIN=<origem exata da SPA>` (não `*` com credenciais).

Em dev, o jeito limpo é um **proxy do Vite** (`/api` → `localhost:3010`) — vira mesma
origem e o cookie `Lax` funciona.

## Ferramentas de diagnóstico (`scripts/`)

Scripts avulsos, rodados à mão com `node scripts/<nome>.mjs`. Não entram no build nem
no contêiner — existem para responder uma pergunta específica quando ela aparece.

Dois tipos, pelo prefixo:

- **`diag-*`** — investigam um sintoma já observado, falando direto com o banco. **Nenhum
  persiste escrita:** o único que chega a executar comando de escrita é o
  `diag-caminho-escrita-totem.mjs`, e ele roda tudo dentro de uma transação com `rollback` —
  é assim que prova o caminho da escrita sem criar linha nenhuma.
- **`smoke-*`** — conferem que uma corrente inteira responde o que a tela espera, pelo HTTP.
  Como todos fazem **login**, todos criam sessão em `hub_sessions`; e um deles grava de
  propósito (ver o aviso abaixo da tabela).

| Script | Responde a pergunta |
|---|---|
| `diag-auth-uid-nas-rpcs.mjs` | As RPCs de totem enxergam quem está chamando? (`auth.uid()` nulo nega a operação) |
| `diag-withrls-resolve.mjs` | O `withRls` conserta esse `auth.uid()` nulo? (continuação do anterior) |
| `diag-caminho-escrita-totem.mjs` | A escrita de totem passa sob o role REAL da API — não sob `postgres`, que passaria mesmo com os grants errados |
| `diag-cbs-quem-le.mjs` | Por que 4 seções da Reforma Tributária vêm vazias no Manager novo, com o mesmo código do antigo? |
| `diag-cbs-tipos-colunas.mjs` | Qual o tipo REAL de cada coluna de CBS que a tela lê como booleano? |
| `diag-inbox-retencao.mjs` | O que uma política de retenção na `ecb_sync.inbox` apagaria — e o que deixaria de existir junto (ela é o livro-caixa de idempotência) |
| `diag-sync-panel-lento.mjs` | Por que o Monitor de Sincronização demora a abrir? (medido: ~67 s) |
| `diag-grants-billing-ai.mjs` | Os GRANTs de `/billing` e `/ai` funcionam **sob o role `easyfood_api`**? (pergunta pelo NOME do role: conectado como `postgres`, qualquer teste de privilégio passaria sem provar nada) |
| `indices-sync-inbox.mjs` | **ESCREVE.** Cria os índices por tenant que faltam na `ecb_sync.inbox` (~3,8 mi de linhas). `SO_MEDIR=1` só mede, sem criar |
| `contrato-http.mjs` | Esta mudança alterou o que a API expõe? (rotas, marcas de segurança, ordem dos guards, OpenAPI) — só lê o `dist/`, com ambiente falso; não conecta em nada. É o `npm run contract:check` |
| `smoke-fatia-vertical.mjs` | A corrente inteira do Caminho 3 responde pelo HTTP? (login → cookie → contexto → lojas → produtos) |
| `smoke-cbs-contrato.mjs` | As rotas de CBS devolvem o que a tela lê — inclusive no TIPO certo? |
| `smoke-totem-write-schema.mjs` | Cada campo do payload de totem existe no banco com o nome certo? (só lê o catálogo) |
| `smoke-billing-ia.mjs` | **ESCREVE.** A corrente de billing e IA responde pelo HTTP? (login → tenant em header → créditos/licença/planos → chat SSE → e a prova final: o uso apareceu em `billing.usage_log`?) |

> ### ⚠️ O que altera o banco — confira antes de apontar para produção
>
> - **`indices-sync-inbox.mjs`** — cria índices na `ecb_sync.inbox`. Rode com `SO_MEDIR=1`
>   antes, para ver o que ele faria.
> - **`smoke-billing-ia.mjs`** — grava e apaga uma conversa de teste em
>   `billing.ai_chat_sessions` e, se o chat rodar, deixa uma linha em `billing.usage_log` +
>   `public.activity_logs` que **não** é limpa depois. `PULAR_CHAT=1` pula essa parte. É
>   escrita em tabela de **cobrança**: rode contra uma empresa sua. Não queima crédito — a
>   pergunta do teste é de navegação, que é grátis e não consome cota —, mas deixa rastro.
> - **Todo `smoke-*`** faz login e portanto cria sessão em `hub_sessions`. O da fatia vertical
>   faz `logout` no fim; o de billing/IA **não**, então a sessão fica até expirar.
>
> Os demais só leem. **Esta lista já esteve errada:** afirmava que `indices-sync-inbox.mjs`
> era o único que alterava o banco, enquanto o smoke de billing/IA gravava em tabela de
> cobrança — exatamente o tipo de engano que faz alguém rodar um "smoke" contra produção
> achando que nada é gravado. Script novo entra aqui **e** na tabela acima.

Variáveis que alguns esperam no ambiente: `EASYFOOD_API`, `EASYFOOD_EMAIL`, `EASYFOOD_SENHA`
(os smokes que falam por HTTP), `EASYFOOD_EMPRESA`/`EASYFOOD_LOJA` e `PULAR_CHAT` (o de
billing/IA), `EMPRESA`/`LOJA` (o do painel lento), `SUPABASE_DB_URL` ou `DATABASE_URL` (os que
falam direto com o banco).

## Estrutura (EasyML)

```
src/
├── main.ts        # helmet, cookie-parser, trust proxy, prefixo /api/v1,
│                  #   fail-fast do env + aviso de segredo ausente (por NOME, nunca valor)
├── bootstrap/     # o que o main liga: cors.ts (regra pura, testada) e swagger.ts
├── config/        # env.ts (Zod) + ConfigModule global — todo process.env passa por aqui
├── common/        # os 3 guards GLOBAIS, nesta ordem (a ordem é o contrato):
│                  #   1. SessionThrottlerGuard  rate-limit por SESSÃO (anônimo cai no IP)
│                  #   2. AuthGuard              @Public / @ServiceOnly / sessão
│                  #   3. TenantGuard            X-Company-Id / X-Store-Id contra o banco
│                  # + filtro (envelope de erro), pipe Zod, cookie de sessão, helpers de
│                  #   Swagger, logger EasySoft + x-request-id, pode-administrar-loja,
│                  #   http/ (@UserId, @CompanyId, @StoreId — o tenant já validado),
│                  #   mapping/ (linha do banco → fio), validation/
├── contract/      # a FORMA DO FIO das rotas de dado (o JSON que a UI espera), em Zod
├── db/            # DbService (pool + withRls + withTransaction + typeParsers), Queryable,
│                  #   service-role (CHOKEPOINT rotulado), supabase-admin (GoTrue/Storage),
│                  #   session.service (sessões opacas)
└── modules/       # telas do Manager: me · catalog · operations · nfce · cbs · devices ·
                   #   sync-panel · billing · ai
                   # edge functions migradas: auth · telemetry · totems · stores
                   # máquina-a-máquina: tenants · sync · storage
                   # health
```

### Camadas de um módulo

Todo módulo tem a mesma forma (o de referência é [`operations`](src/modules/operations)):

```
modules/<modulo>/
├── <modulo>.module.ts
├── http/            # controllers finos + *.docs.ts (a documentação Swagger de cada rota)
├── application/     # casos de uso: orquestram, aplicam a regra, entregam na forma do fio
├── domain/          # regras e mapeadores PUROS — sem Nest, sem banco, sem HTTP
├── infrastructure/  # repositórios (TODO o SQL) e clientes externos (Supabase, EasyAI, e-mail)
└── dto/             # schemas Zod de entrada
```

```
http → application → infrastructure
              ↘          ↓
                domain
```

- **Controller** não conhece banco nem repositório: valida a entrada (Zod), pega o tenant
  pelos decorators (`@CompanyId()`, `@StoreId()`, `@UserId()`) e chama um caso de uso.
- **Caso de uso** não contém SQL nem `fetch`: decide, e traduz erro de infraestrutura em
  resposta (`HttpException`).
- **Repositório** não decide regra nem lança erro de negócio: consulta e devolve linha
  tipada. Dentro de transação, recebe o `Queryable` do client que a abriu.
- **Domain** é função pura — é onde mora o teste barato.

O ESLint cobra essas setas (`no-restricted-imports` por pasta): furar a camada quebra o CI.
