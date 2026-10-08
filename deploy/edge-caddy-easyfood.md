# Bloco do Caddy edge — EasyFoodAPI

A EasyFoodAPI é uma **API standalone** (sem SPA), então o Caddy "edge" compartilhado da VPS
faz `reverse_proxy` **direto** pro container da API (porta 3010). O TLS é automático (ACME).

## Pré-requisito
- Registro DNS **A**: `easyfood-api.easysoftcloud.com.br` → IP da VPS.
- O container `easyfood-api` na rede externa `edge` (ver `docker-compose.prod.yml`).

## Bloco a adicionar no Caddyfile do edge (`/root/stack/edge/Caddyfile`)

```caddy
easyfood-api.easysoftcloud.com.br {
    encode gzip zstd
    reverse_proxy easyfood-api:3010
}
```

> A API tem prefixo global `/api/v1` e cuida do próprio **CORS** (via `CORS_ORIGIN`) e do
> cookie de sessão. Como escolhemos **subdomínio próprio + CORS**, o login de browser precisa,
> no cofre, de `SESSION_COOKIE_SAMESITE=none` + `CORS_ORIGIN=<domínio do front>` (isso se
> finaliza no cutover do front). As rotas máquina-a-máquina (`/tenants/provision`, `X-Service-Key`)
> já funcionam sem cookie/CORS.

## Aplicar (sem downtime)

```sh
docker exec edge caddy validate --config /etc/caddy/Caddyfile
docker exec edge caddy reload   --config /etc/caddy/Caddyfile
# valida o TLS/roteamento:
curl -sI https://easyfood-api.easysoftcloud.com.br/api/v1/health/live | head -n 1
```
