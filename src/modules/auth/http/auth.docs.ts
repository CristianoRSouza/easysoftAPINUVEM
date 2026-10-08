import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  ApiDocs,
  ApiSessionAuth,
  ApiSessionErrorResponses,
  ApiSessionInfraErrorResponses,
  ApiSessionUnauthorizedResponse,
  ApiThrottleErrorResponse,
  ApiValidationErrorResponse,
  errorSchema,
} from '../../../common/swagger';

/**
 * Documentação OpenAPI das rotas de identidade — fora dos controllers, para eles mostrarem
 * só o que decide o comportamento (rota, throttle, público ou não, cookie, caso de uso).
 *
 * Cada `Doc*` equivale a empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

export const DocLogin = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Login por e-mail/senha — emite a sessão no cookie httpOnly',
      description:
        'A API é o servidor de auth (EasyML §2): valida a senha **server-side** contra o Supabase Auth e emite ' +
        'um **token opaco próprio** — o browser NUNCA recebe o JWT do Supabase. O token vai num cookie ' +
        '`httpOnly` (`SESSION_COOKIE_NAME`) e no banco fica só o `sha256`.\n\n' +
        'A resposta traz **apenas** `{ user }`: o token não aparece no corpo de propósito (se aparecesse, JS ' +
        'poderia lê-lo e o `httpOnly` perderia o sentido). Clientes não-browser leem o token do header ' +
        '`Set-Cookie` e o reusam como `Authorization: Bearer`.\n\n' +
        'Credencial errada devolve **401 genérico** — não revela se o e-mail existe. Rate-limit apertado: ' +
        '10 requisições/minuto por IP.',
    }),
    ApiBody({
      required: true,
      schema: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'usuario@exemplo.com.br' },
          password: { type: 'string', minLength: 1, example: '<senha>' },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Autenticado. O cookie de sessão vem no header `Set-Cookie` (httpOnly, sliding-expiry).',
      headers: {
        'Set-Cookie': {
          description: 'Cookie de sessão httpOnly (`SESSION_COOKIE_NAME`), com `SameSite`/`Secure` conforme o env.',
          schema: { type: 'string', example: 'easyfood_session=<token-opaco>; Path=/; HttpOnly; SameSite=Lax' },
        },
      },
      schema: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid', example: '00000000-0000-4000-8000-000000000000' },
              email: { type: 'string', format: 'email', example: 'usuario@exemplo.com.br' },
            },
          },
        },
      },
    }),
    ApiValidationErrorResponse(),
    ApiResponse({
      status: 401,
      description: 'E-mail ou senha inválidos. Mensagem genérica de propósito (não enumera contas).',
      schema: errorSchema(['invalid_credentials'], 'E-mail ou senha inválidos.', 401),
    }),
    ApiThrottleErrorResponse('10 tentativas/minuto por IP'),
  );

export const DocLogout = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Revoga a sessão atual e limpa o cookie',
      description:
        'Apaga a linha de `hub_sessions` (e o cache em memória) e manda o browser descartar o cookie. É ' +
        '**pública** de propósito: uma sessão já expirada/inválida ainda precisa conseguir limpar o cookie do ' +
        'browser — exigir sessão válida deixaria o cliente preso com um cookie morto. Sem corpo; o token vem do ' +
        'cookie ou do header `Authorization`. Responde `{ ok: true }` mesmo se não havia sessão (idempotente).',
    }),
    ApiResponse({
      status: 200,
      description: 'Sessão revogada (ou já inexistente) e cookie limpo.',
      schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } },
    }),
    ApiThrottleErrorResponse(),
  );

export const DocMe = () =>
  ApiDocs(
    ApiSessionAuth(),
    ApiOperation({
      summary: 'Quem sou eu — id e e-mail do dono da sessão',
      description:
        'O id vem da SESSÃO (`req.user`, populado pelo `AuthGuard`), nunca de parâmetro — não há como consultar ' +
        'outro usuário por aqui. O e-mail é lido pela portaria GoTrue (Auth admin via HTTPS), **não** por ' +
        '`auth.users` no Postgres (EasyML §6: o role do banco só toca `public.*`). Se o Auth não devolver o ' +
        'usuário, `email` volta `null` — a rota não falha.',
    }),
    ApiResponse({
      status: 200,
      description: 'Identidade da sessão corrente.',
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', example: '00000000-0000-4000-8000-000000000000' },
          email: { type: 'string', nullable: true, format: 'email', example: 'usuario@exemplo.com.br' },
        },
      },
    }),
    ApiSessionErrorResponses(),
  );

export const DocDerivedSession = () =>
  ApiDocs(
    ApiSessionAuth(),
    ApiOperation({
      summary: 'Emite um token de sessão derivada (magiclink) para outro app do ecossistema',
      description:
        'Migra a edge function `mint-derived-session`. Gera, pelo Auth admin (chokepoint `service_role`), um ' +
        '`token_hash` de **magiclink** para o e-mail do **próprio usuário logado** — o app derivado consome com ' +
        '`verifyOtp`. Quem identifica o chamador é a **sessão da API**, não um Bearer JWT do Supabase.\n\n' +
        'Nenhum e-mail é enviado: só o hash é devolvido. Validade de 1 hora (`expires_in: 3600`). O ' +
        '`redirect_to` é opcional e só compõe o link gerado.',
    }),
    ApiBody({
      required: false,
      description: 'Corpo opcional — pode ser omitido ou `{}`.',
      schema: {
        type: 'object',
        properties: {
          redirect_to: {
            type: 'string',
            format: 'uri',
            description: 'URL de retorno do magiclink (validada como URL pelo Zod).',
            example: 'https://manager.easysoftcloud.com.br/callback',
          },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Token derivado emitido (não enviado por e-mail).',
      schema: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email', example: 'usuario@exemplo.com.br' },
          token_hash: { type: 'string', example: '<hashed_token>' },
          type: { type: 'string', enum: ['magiclink'], example: 'magiclink' },
          expires_in: { type: 'integer', example: 3600 },
        },
      },
    }),
    ApiValidationErrorResponse(),
    ApiSessionUnauthorizedResponse([], 'Sessão ausente. Faça login. (Ou: usuário logado sem e-mail no Auth.)'),
    ApiSessionInfraErrorResponses(),
    ApiResponse({
      status: 500,
      description: 'O Auth admin não devolveu o `hashed_token` (`mint_failed`) ou erro interno não tratado.',
      schema: errorSchema(['mint_failed', 'internal_error'], 'Falha ao emitir a sessão derivada.', 500),
    }),
  );

export const DocSsoSupport = () =>
  ApiDocs(
    ApiSessionAuth(),
    ApiOperation({
      summary: 'Token SSO para auto-login no projeto Support',
      description:
        'Migra a edge function `sso-support`. Assina (HMAC-SHA256 com `SSO_SHARED_SECRET`) um token curto com ' +
        'e-mail/nome do usuário logado e devolve a `redirect_url` pronta para o Support.\n\n' +
        '**Formato imutável** (contrato com o Support): `base64url(json).base64url(hmac)`, payload ' +
        '`{ email, name, source_user_id, iat, exp, iss: "easycommandpay" }`, validade de **120 segundos**. ' +
        'Sem corpo — tudo vem da sessão. Sem `SSO_SHARED_SECRET` configurado a rota devolve 500 ' +
        '(`sso_not_configured`), nunca um token inválido.',
    }),
    ApiResponse({
      status: 200,
      description: 'Token assinado + URL de redirecionamento para o Support.',
      schema: {
        type: 'object',
        properties: {
          token: { type: 'string', example: '<payload-b64url>.<hmac-b64url>' },
          redirect_url: {
            type: 'string',
            format: 'uri',
            description: 'Host = `SUPPORT_SSO_ENDPOINT`, com o token já URL-encoded na query.',
            example: 'https://projeto-support.supabase.co/functions/v1/sso?token=SEU_TOKEN',
          },
        },
      },
    }),
    ApiSessionUnauthorizedResponse([], 'Sessão ausente. Faça login. (Ou: usuário logado sem e-mail no Auth.)'),
    ApiSessionInfraErrorResponses(),
    ApiResponse({
      status: 500,
      description: '`SSO_SHARED_SECRET` ausente no ambiente (fail-closed) ou erro interno não tratado.',
      schema: errorSchema(['sso_not_configured', 'internal_error'], 'SSO_SHARED_SECRET ausente.', 500),
    }),
  );

export const DocRecoveryEmail = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Envia o e-mail de redefinição de senha (resposta constante, não enumera contas)',
      description:
        'Migra `send-recovery-email`. **Pública** e com rate-limit de 10/minuto por IP.\n\n' +
        '**Privacidade:** a entrega roda em *background* e a resposta é **200 `{ ok: true }` constante** — mesmo ' +
        'corpo, status e tempo, exista ou não a conta. Isso fecha enumeração por corpo, por status e por timing. ' +
        'O 400 só aparece para erro de **formato** da requisição (e-mail malformado ou destino não autorizado), ' +
        'nunca para "conta inexistente".\n\n' +
        '**Anti open-redirect:** `redirect_to` só é aceito em **https** e em host da allowlist ' +
        '(`*.easysoftcloud.com.br`); fora disso é 400. Sem `redirect_to`, o destino sai do registro de apps pela ' +
        'chave `app` (hoje só `manager`) — `app` desconhecido é 400.\n\n' +
        '⚠️ O erro desta rota sai como `{ error: "<motivo>" }` (formato as-is da edge function migrada), **sem** ' +
        'o envelope `{ error, message, statusCode }`: o status é setado no `Response`, então não passa pelo ' +
        '`HttpExceptionFilter`.',
    }),
    ApiBody({
      required: true,
      schema: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email', example: 'usuario@exemplo.com.br' },
          app: {
            type: 'string',
            description: 'Chave do registro de apps (define URL de reset, assunto e branding). Hoje: `manager`.',
            example: 'manager',
          },
          redirect_to: {
            type: 'string',
            format: 'uri',
            description: 'URL de reset custom. Só https e host da allowlist — precede a chave `app`.',
            example: 'https://manager.easysoftcloud.com.br/reset-password',
          },
          app_name: { type: 'string', description: 'Nome exibido no e-mail (máx. 80 chars).', example: 'EasyCommandPay Manager' },
          subject: { type: 'string', description: 'Assunto do e-mail (sobrescreve o do registro).' },
          source: { type: 'string', description: 'Rótulo de origem, para rastreio no EasyMail.' },
          brand_color: { type: 'string', description: 'Cor hex `#RRGGBB`; valor inválido cai no default.', example: '#3B8EE8' },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description:
        'Aceito. **Não** significa que o e-mail existe nem que a mensagem saiu — a entrega é assíncrona e o ' +
        'resultado é deliberadamente invisível ao cliente.',
      schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } },
    }),
    ApiResponse({
      status: 400,
      description:
        'Erro de FORMATO da requisição: e-mail malformado, `redirect_to` inválido/não autorizado ou `app` ' +
        'desconhecido. Corpo as-is `{ error }`, sem o envelope padrão.',
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'string',
            example: 'Email inválido',
            enum: ['Email inválido', 'redirect_to inválido', 'Domínio de redirect_to não autorizado', 'App desconhecido: <app>'],
          },
        },
      },
    }),
    ApiThrottleErrorResponse('10 requisições/minuto por IP'),
  );
