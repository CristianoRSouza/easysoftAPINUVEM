#!/usr/bin/env bash
# Gera o api.env da EasyFoodAPI a partir do cofre Infisical (padrão EasyML).
# Roda na VPS, no diretório /root/stack/easyfood-api/. Reexecutar sempre que um segredo mudar.
#
# ⚠️ Os flags do CLI `infisical` variam por versão. Se você já tem um refresh-env.sh
#    funcionando no EasyML/Sync, o mais seguro é COPIAR aquele e só trocar o projeto/saída.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
IDENT="$DIR/infisical-identity.env"
OUT="$DIR/api.env"

[ -f "$IDENT" ] || { echo "ERRO: falta $IDENT (Machine Identity do cofre)"; exit 1; }
# shellcheck disable=SC1090
set -a; . "$IDENT"; set +a
API_URL="${INFISICAL_API_URL:-https://vault.easysoftcloud.com.br/api}"

echo ">> login na Machine Identity (read-only)..."
export INFISICAL_TOKEN
INFISICAL_TOKEN="$(infisical login --method=universal-auth \
  --client-id="$INFISICAL_UNIVERSAL_AUTH_CLIENT_ID" \
  --client-secret="$INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET" \
  --domain="$API_URL" --plain --silent)"

echo ">> exportando segredos do ambiente prod..."
TMP="$(mktemp)"
infisical export --format=dotenv --env=prod \
  --projectId="$INFISICAL_PROJECT_ID" --domain="$API_URL" \
  | sed "s/'//g" > "$TMP"

# Validação mínima: aborta SEM tocar o api.env se faltar chave crítica.
for k in SERVICE_API_KEY SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY DATABASE_URL; do
  grep -q "^$k=" "$TMP" || { echo "ERRO: cofre sem $k — abortando (api.env mantido)"; rm -f "$TMP"; exit 1; }
done

# Backup + instala com permissão 600.
[ -f "$OUT" ] && cp -a "$OUT" "$OUT.bak.$(date +%Y%m%d%H%M%S)"
install -m 600 "$TMP" "$OUT"
rm -f "$TMP"
echo ">> api.env atualizado ($(grep -c '=' "$OUT") chaves). Recriando container..."
docker compose -f "$DIR/docker-compose.yml" up -d
echo ">> pronto."
