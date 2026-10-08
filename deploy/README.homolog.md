# EasyFoodAPI de HOMOLOGAÇÃO na nuvem

É a segunda stack da mesma imagem, na mesma VPS, apontada para o projeto Supabase de
homologação (`ltixkslqlreybdhutpbr`).

| | Produção | Homologação |
|---|---|---|
| Pasta na VPS | `/root/stack/easyfood-api/` | `/root/stack/easyfood-api-homolog/` |
| Container | `easyfood-api` | `easyfood-api-homolog` |
| Cofre Infisical | projeto `easyfood-api`, env `prod` | projeto **`easyfood-api-homolog`**, env `prod` |
| Banco | pooler **aws-1**, `nyoqadtohcgiwrbhoqdo` | pooler **aws-0**, `ltixkslqlreybdhutpbr` |
| Domínio | `easyfood-api.easysoftcloud.com.br` | `easyfood-api-homolog.easysoftcloud.com.br` |

**Por que existe:** até 30/09/2026 a API de homolog só rodava em `localhost:3010` no PC de
desenvolvimento. Uma loja de teste instalada em outra rede física ficava com `fetch failed`
em tudo, e o POS não recebia usuários.

## Passo a passo (uma vez)

### 1. DNS
Criar um registro **A** `easyfood-api-homolog.easysoftcloud.com.br` apontando para o mesmo
IP de `easyfood-api.easysoftcloud.com.br`.

### 2. Cofre Infisical (projeto separado, obrigatório)
Criar o projeto **`easyfood-api-homolog`** com o ambiente **`prod`**. O `refresh-env.sh`
tem `--env=prod` fixo, e o nome do ambiente não importa: o que isola é o projeto.
Cadastrar as chaves do `.env` de homolog usado até hoje no PC de desenvolvimento, com três
ajustes:
- `NODE_ENV=production`
- `PORT=3010`
- `DATABASE_SSL_REJECT_UNAUTHORIZED=true`. A imagem já traz o CA da Supabase.

O `SERVICE_API_KEY` precisa ser o **mesmo** valor que as lojas de homolog usam em
`SUPABASE_SYNC_API_SERVICE_KEY` e `PROVISION_TENANT_SERVICE_KEY`.

> ⚠️ **Não reuse o cofre de produção.** A trava do `docker-compose.homolog.yml` recusa o
> boot, com exit 78, se `DATABASE_URL` ou `SUPABASE_URL` não forem do homolog.

Por fim, criar uma **Machine Identity read-only** (Universal Auth) escopada a esse projeto.
Anotar o Client ID, o Client Secret e o Project ID.

### 3. Stack na VPS
```sh
mkdir -p /root/stack/easyfood-api-homolog && cd /root/stack/easyfood-api-homolog
# copiar deste repo (deploy/):
#   docker-compose.homolog.yml -> docker-compose.yml
#   .env.homolog.example       -> .env
#   refresh-env.sh             -> refresh-env.sh   (o mesmo da produção)
#   infisical-identity.env.example -> infisical-identity.env  (preencher com a identity DE HOMOLOG)
chmod 600 infisical-identity.env && chmod +x refresh-env.sh
./refresh-env.sh          # gera o api.env a partir do cofre de homolog e sobe o container
docker logs --tail 50 easyfood-api-homolog
```

### 4. Caddy edge
No Caddyfile do edge (`/root/stack/edge/Caddyfile`):
```caddy
easyfood-api-homolog.easysoftcloud.com.br {
    encode gzip zstd
    reverse_proxy easyfood-api-homolog:3010
}
```
```sh
docker exec edge caddy validate --config /etc/caddy/Caddyfile
docker exec edge caddy reload   --config /etc/caddy/Caddyfile
curl -sI https://easyfood-api-homolog.easysoftcloud.com.br/api/v1/health/live | head -n 1   # 200
```

### 5. Lojas de homolog
No `.env` do Sync-PG-SB de cada loja de teste:
```
SUPABASE_SYNC_API_BASE_URL=https://easyfood-api-homolog.easysoftcloud.com.br/api/v1
PROVISION_TENANT_BASE_URL=https://easyfood-api-homolog.easysoftcloud.com.br/api/v1
```
Grave **sem BOM** e reinicie o serviço.

## Esteira de deploy (desde 30/09/2026)

```
feature/* --PR--> hom --push--> deploy HOMOLOGAÇÃO (compila; imagem t-<árvore do código>)
                   |
                   +--PR (só de hom)--> main --push--> deploy PRODUÇÃO (promove a MESMA imagem)
```

- **`hom` é o branch padrão.** Todo PR novo nasce apontando para ele.
- **A produção não recompila.** A imagem é identificada pela árvore do código
  (`git rev-parse HEAD^{tree}`), que é idêntica em `hom` e no merge em `main`. Se a `main`
  receber código que não passou pela `hom`, não existe imagem para ele e o deploy de
  produção **falha de propósito**.
- **PR para a `main` só vem de `hom`.** Quem garante é o check obrigatório `origem-e-hom`.
- **O GitHub vai mostrar a `hom` "atrás da `main`"** por alguns commits de merge. É só visual:
  esses merges não trazem código, e a próxima promoção continua batendo a árvore. Não é
  preciso trazer a `main` de volta para a `hom`, **exceto** depois de um commit de
  emergência direto na `main`. Nesse caso, abra um PR `main → hom` antes da próxima
  promoção, senão o deploy de produção falha por falta de imagem.
- **Emergência:** o admin pode furar a regra e mesclar direto na `main`. O deploy automático
  vai falhar (não há imagem), e aí é **Actions → CI/CD → Run workflow** na `main` com
  `emergencia=true`, que compila da `main` e publica na produção.

## Conferir o alvo sem imprimir segredo
```sh
docker exec easyfood-api-homolog node -e 'console.log(new URL(process.env.DATABASE_URL).username, new URL(process.env.SUPABASE_URL).host)'
# postgres.ltixkslqlreybdhutpbr ltixkslqlreybdhutpbr.supabase.co
```
