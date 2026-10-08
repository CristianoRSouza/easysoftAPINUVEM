# EasyFood API — build multi-stage (Node 22 → runtime enxuto, non-root)
# Node 22: exigido pelo @supabase/supabase-js recente (padrão EasyML).
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Identidade da imagem (GET /api/v1/health/build). O CI passa t-<árvore do código>; a
# produção promove a imagem da homologação sem recompilar, então as duas mostram o mesmo.
ARG BUILD_ID=dev
ENV BUILD_ID=${BUILD_ID}
# usuário não-root (padrão EasyML: nestjs:nodejs 1001)
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nestjs
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# CA da Supabase (Root/Intermediate 2021) p/ o TLS do banco validar a identidade do pooler.
# Com NODE_EXTRA_CA_CERTS, basta DATABASE_SSL_REJECT_UNAUTHORIZED=true (sem DATABASE_CA_CERT).
COPY certs/supabase-ca.crt /etc/ssl/certs/supabase-ca.crt
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/supabase-ca.crt
USER nestjs
EXPOSE 3010
# Env vem do cofre (Infisical → api.env), nunca de .env versionado.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3010/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
