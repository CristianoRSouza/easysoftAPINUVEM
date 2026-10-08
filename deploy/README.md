# Deploy — EasyFoodAPI (padrão EasyML/Sync)

Modelo idêntico ao EasyML e EasyERP-Sync, porém **mais enxuto** (API standalone, sem SPA):

```
push main → GitHub Actions (build+test → docker build+push no Docker Hub)
          → SSH na VPS → troca API_TAG no .env → docker compose pull → up -d --force-recreate
          → Caddy edge (TLS automático) faz reverse_proxy → container :3010
```

- **VPS:** SaveInCloud PaaS · SSH `gate.paas.saveincloud.net.br:3022` · user `270104-26675` · stack em `/root/stack/easyfood-api/`
- **Registry:** Docker Hub `neanderalmeida/easyfood-api` (privado)
- **Domínio:** `easyfood-api.easysoftcloud.com.br`
- **Cofre:** Infisical (`vault.easysoftcloud.com.br`), projeto `easyfood-api`, env `prod`
- **Banco:** pooler `aws-1-sa-east-1.pooler.supabase.com:5432` com o role de **menor privilégio**

Arquivos deste diretório: `docker-compose.prod.yml` (stack da VPS), `.env.example` (tags),
`refresh-env.sh` + `infisical-identity.env.example` (segredos do cofre), `edge-caddy-easyfood.md`
(bloco do Caddy). CI em `.github/workflows/ci.yml`. Dockerfile na raiz.

---

## Checklist de setup (uma vez) — o que VOCÊ faz

### 1. Banco: role de menor privilégio na PROD
Rode `sql/least-privilege-role.sql` no SQL Editor da prod, **trocando `TROQUE-ESTA-SENHA` por uma senha forte**.
O `DATABASE_URL` do cofre usa esse role pelo pooler — **atenção ao formato do usuário do pooler**
(`<role>.<projectref>`):
```
DATABASE_URL=postgresql://easyfood_api.nyoqadtohcgiwrbhoqdo:<SENHA_FORTE>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
```

### 2. Docker Hub
Criar o repositório privado `neanderalmeida/easyfood-api` (ou deixar o 1º push criar) + um **Access Token** (Read/Write).

### 3. Secrets no GitHub (repo easyfood-api → Settings → Secrets → Actions)
- `DOCKERHUB_TOKEN` = o access token acima.
- `VPS_SSH_KEY` = chave **privada** SSH cuja pública está no `authorized_keys` do user da VPS.

### 4. Cofre Infisical
- Criar projeto **`easyfood-api`**, ambiente **`prod`**.
- Cadastrar todas as chaves (ver `.env.example` da raiz — as de produção). Mínimo que o boot exige:
  `SERVICE_API_KEY` (≥32), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`. Incluir também
  `SUPABASE_ANON_KEY`, `SENSITIVE_SECRET_MASTER_KEY_BASE64` (idêntica ao Electron/Sync/totens),
  `SSO_SHARED_SECRET_EASYFOOD` (e/ou a legada `SSO_SHARED_SECRET` — ver "SSO do Suporte" abaixo),
  `ERROR_REPORT_SECRET`, `CORS_ORIGIN`, `NODE_ENV=production`, `PORT=3010`,
  e, quando for ligar o login de browser, `SESSION_COOKIE_SAMESITE=none`.
- TLS do banco: preferir `DATABASE_CA_CERT` (PEM do painel) + `DATABASE_SSL_REJECT_UNAUTHORIZED=true`.
  Se o CA do pooler não validar, `DATABASE_SSL_REJECT_UNAUTHORIZED=false` (criptografa mas não verifica identidade) — o boot loga o estado.
- Criar **Machine Identity read-only** `easyfood-api-prod` (Universal Auth), escopada ao projeto/prod; anotar Client ID, Client Secret e Project ID.

### 5. VPS — preparar a stack
```sh
mkdir -p /root/stack/easyfood-api && cd /root/stack/easyfood-api
# copiar os arquivos do repo (deploy/docker-compose.prod.yml → docker-compose.yml; deploy/.env.example → .env)
#   e criar infisical-identity.env (chmod 600) a partir do .example, com os dados da Machine Identity.
chmod 600 infisical-identity.env
./refresh-env.sh          # gera o api.env (600) a partir do cofre
```
> Se já tem um `refresh-env.sh` funcionando no EasyML/Sync, **copie aquele** e só troque o projeto/saída — os flags do CLI `infisical` variam por versão.

### 6. DNS + Caddy edge
- Registro **A**: `easyfood-api.easysoftcloud.com.br` → IP da VPS.
- Adicionar o bloco de `deploy/edge-caddy-easyfood.md` no Caddyfile do edge + `caddy validate`/`reload`.

---

## Primeiro deploy
`git push` na `main` → o Actions testa, builda, faz push da imagem (`:v<run>` + `:latest`) e deploya por SSH.
(Alternativa manual sem Actions: `docker build`+`push` do PC, depois `ssh` trocando `API_TAG` + `pull`/`up -d`.)

## Verificar
```sh
curl -sI https://easyfood-api.easysoftcloud.com.br/api/v1/health/live   # 200
```
E o smoke máquina-a-máquina do `/tenants/provision` (com `X-Service-Key`) — sem cookie/CORS.

### SSO do Suporte (botão "Suporte" do Manager)

O botão só funciona se a API tiver **uma** destas no ambiente: `SSO_SHARED_SECRET_EASYFOOD`
(dedicada, preferida) ou `SSO_SHARED_SECRET` (legada, ponte). Sem nenhuma, a rota devolve
**500 `sso_not_configured`** e o Manager mostra "Suporte indisponível" — foi exatamente o que
aconteceu em 31/07/2026: o cofre subiu sem a chave.

A dedicada **só é aceita depois** que a function `sso` do EasyChat for publicada no Lovable
com a terceira chave (`docs/PROMPT-LOVABLE-sso-chave-easyfood.md`); antes disso ela vira
`{"error":"Invalid signature"}`. Ordem segura: legada no cofre → publica o Lovable → dedicada.

### Telemetria de erro (`ERROR_REPORT_SECRET`)

Mesmo enredo, mesma origem: o cofre subiu sem essa chave e a API passou a mandar
`x-report-secret` **vazio** ao EasyGuardian, que responde **401** a todo relatório — e o browser
reporta em fire-and-forget, então o erro sumia sem ninguém notar. Hoje a rota falha fechado
(**503 `telemetry_not_configured`** + `warn` no log) em vez de gastar a chamada.

O valor é o mesmo já usado pelas edge functions do EasyERP (`nyoqadtohcgiwrbhoqdo`,
digest `bbc5df3a…`). Conferir presença no container e comparar digest sem imprimir valor:

```sh
docker exec easyfood-api node -e '
const s=process.env.ERROR_REPORT_SECRET||"";
console.log(s?"presente: len="+s.length+" fp="+require("crypto").createHash("sha256").update(s).digest("hex").slice(0,12):"AUSENTE");'
```

### Verificação do SSO

Teste ao vivo, **sem imprimir o segredo** (roda de dentro do container; só mostra fingerprint
e status HTTP). `302` = assinatura aceita; a contraprova com segredo aleatório tem que dar `401`:

```sh
docker exec easyfood-api node -e '
const c=require("crypto");
const s=process.env.SSO_SHARED_SECRET_EASYFOOD||process.env.SSO_SHARED_SECRET||"";
if(!s){console.log("SEM CHAVE no ambiente do container");process.exit(1)}
console.log("chave em uso: len="+s.length+" fp="+c.createHash("sha256").update(s).digest("hex").slice(0,12));
const url=process.env.SUPPORT_SSO_ENDPOINT||"https://puqybpgzhwaxmhedqhqu.supabase.co/functions/v1/sso";
const now=Math.floor(Date.now()/1e3);
const p=Buffer.from(JSON.stringify({email:"contato@easysoftsistemas.com.br",name:"Diagnostico SSO",
  source_user_id:"00000000-0000-0000-0000-000000000000",iat:now,exp:now+120,iss:"easycommandpay"})).toString("base64url");
const go=(k,rot)=>fetch(url+"?token="+encodeURIComponent(p+"."+c.createHmac("sha256",k).update(p).digest("base64url")),
  {redirect:"manual"}).then(r=>r.status===302?console.log(rot+": HTTP 302 (aceita)"):r.text().then(t=>console.log(rot+": HTTP "+r.status+" "+t)));
go(s,"chave real").then(()=>go(c.randomBytes(32).toString("hex"),"contraprova (segredo aleatorio)"));
'
```

## Rollback
```sh
sed -i 's/^API_TAG=.*/API_TAG=v<N-anterior>/' /root/stack/easyfood-api/.env
docker compose -f /root/stack/easyfood-api/docker-compose.yml pull
docker compose -f /root/stack/easyfood-api/docker-compose.yml up -d --force-recreate
```

## Gotchas
- **Segredos nunca em git/log**: só o cofre. O deploy nunca faz `cat` do `api.env` (só `grep` da tag).
- **`docker image prune -af`** no deploy é obrigatório (senão o disco da VPS enche).
- **`SERVICE_API_KEY` ≥ 32** senão o boot falha (fail-fast do env).
- **Login de browser** (cookie) só fecha no **cutover do front** (SameSite=none + CORS). As rotas
  máquina-a-máquina já funcionam no deploy inicial.
- **Migrações do banco NÃO vão pelo pipeline do app** — são aplicadas à parte (como fizemos nesta
  fase: SQL Editor / `migration repair`). Padrão EasyML usa workflow `deploy-db.yml` separado.
