import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SEC_SERVICE_KEY, SEC_SESSION_BEARER, SEC_SESSION_COOKIE } from '../common/swagger';
import type { Env } from '../config/env';

/**
 * Swagger / OpenAPI — servido na MESMA porta, sob `/<API_PREFIX>/docs`
 * (JSON em `/<API_PREFIX>/docs-json`). Mesmo desenho do EasyERP-Sync.
 *
 * Dois detalhes que NÃO devem ser mexidos sem entender o efeito:
 *  - `addServer('/api/v1')` + `createDocument(..., { ignoreGlobalPrefix: true })` andam
 *    em par: o prefixo global do Nest não entra nos paths do documento; ele é declarado
 *    uma única vez no `server`. Sem o `ignoreGlobalPrefix`, path e server duplicam o
 *    prefixo e o "Try it out" chama `/api/v1/api/v1/...` → 404.
 *  - `persistAuthorization: true` mantém o valor digitado no botão **Authorize** após reload.
 *
 * Três security schemes (§AuthGuard): a MESMA sessão em dois transportes
 * (`session-cookie` / `session-bearer`) + a chave de serviço (`service-key`).
 */
export function setupSwagger(app: INestApplication, env: Env): void {
  const config = new DocumentBuilder()
    .setTitle('EasyFood API')
    .setDescription(
      'Camada 2 (API de aplicação) do EasyFood — a **única porta** para o Supabase cloud, no padrão de ' +
        '3 camadas do EasyML. Substitui as Edge Functions e o acesso direto ao banco pelo browser.\n\n' +
        'Três caminhos de auth, resolvidos por um `AuthGuard` global: rotas **públicas** (`@Public`), ' +
        'rotas de **sessão de usuário** (cookie httpOnly `' +
        env.SESSION_COOKIE_NAME +
        '` ou `Authorization: Bearer <token opaco>`) e rotas **máquina-a-máquina** (`@ServiceOnly`, header ' +
        '`X-Service-Key`). Não existe header de tenant: a identidade vem da sessão e a autorização por loja ' +
        'é checada server-side (`public.is_company_admin_for_store`).\n\n' +
        'Todo erro sai no mesmo envelope: `{ error, message, statusCode, details? }`.',
    )
    .setVersion(process.env.npm_package_version ?? '0.1.0')
    .setContact('EasySoft Sistemas', '', 'contato@easysoftsistemas.com.br')
    .addServer(`/${env.API_PREFIX}`)
    .addCookieAuth(
      env.SESSION_COOKIE_NAME,
      {
        type: 'apiKey',
        in: 'cookie',
        name: env.SESSION_COOKIE_NAME,
        description:
          'Sessão opaca em cookie **httpOnly** (o browser envia sozinho). Emitido por `POST /auth/login` e ' +
          'renovado por sliding-expiry. É httpOnly: o Swagger UI NÃO consegue preencher este campo por JS — ' +
          'para testar pelo navegador, chame `POST /auth/login` aqui mesmo (mesma origem) e o cookie passa a ' +
          'acompanhar as chamadas seguintes automaticamente.',
      },
      SEC_SESSION_COOKIE,
    )
    .addBearerAuth(
      {
        // `in` é omitido de propósito: no OpenAPI 3.0 ele só vale para `type: apiKey`;
        // num scheme `http`/bearer o campo é inválido e redundante (bearer já implica o
        // header Authorization).
        type: 'http',
        scheme: 'bearer',
        description:
          'A MESMA sessão do cookie, no header `Authorization: Bearer <token>`. Token **opaco** (base64url, ' +
          'sem ponto) — não é JWT; o banco guarda só o `sha256`. Use quando o cliente não for um browser.',
      },
      SEC_SESSION_BEARER,
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-Service-Key',
        description:
          'Chave de serviço (`SERVICE_API_KEY`) para chamadas máquina-a-máquina (`@ServiceOnly`) — hoje só ' +
          '`POST /tenants/provision`, chamado pelo Sync-PG-SB. Comparação timing-safe. Nunca vai ao browser.',
      },
      SEC_SERVICE_KEY,
    )
    .build();

  const document = SwaggerModule.createDocument(app, config, { ignoreGlobalPrefix: true });
  SwaggerModule.setup(`${env.API_PREFIX}/docs`, app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'EasyFood API — docs',
  });

  // Raiz (GET /) redireciona para a doc. Fica FORA do prefixo global, por isso é
  // registrada direto no Express, antes do listen.
  app
    .getHttpAdapter()
    .getInstance()
    .get('/', (_req: unknown, res: { redirect: (url: string) => void }) =>
      res.redirect(`/${env.API_PREFIX}/docs`),
    );
}
