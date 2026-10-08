import { z } from 'zod';
import { DEFAULT_SESSION_COOKIE_NAME } from '../common/session-cookie';

/**
 * Validação de ambiente (fail-fast no boot): toda configuração de COMPORTAMENTO da API
 * passa por aqui, validada, em vez de `process.env` espalhado pelos services (padrão
 * EasyML §5).
 *
 * ── As exceções, que existem e é melhor conhecê-las ───────────────────────────
 * Três lugares leem `process.env` direto, e nenhum é descuido:
 *   • `easysoft-logger.ts` (`LOG_LEVEL`, `LOG_FORMAT`) — o logger é construído ANTES do
 *     `loadEnv()`, para que uma falha de validação do ambiente já saia no formato certo.
 *     Não teria como usar o `Env` que ainda não existe.
 *   • `session-throttler.guard.ts` (`SESSION_COOKIE_NAME`) — roda antes da autenticação e
 *     só precisa do NOME do cookie para montar a chave de contagem. O default vem da
 *     constante compartilhada, não de um literal repetido.
 *   • `app-registry.ts` (`MANAGER_RESET_URL`) — override pontual do destino de
 *     redefinição de senha.
 *
 * O texto anterior aqui dizia "nada de `process.env` espalhado — tudo passa por aqui",
 * o que era categórico demais para o que o código faz. Regra real: configuração nova
 * entra NESTE schema; ler `process.env` direto exige um motivo como os três acima.
 */
const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3010),
  API_PREFIX: z.string().default('api/v1'),
  CORS_ORIGIN: z.string().default('*'),
  // Schema de controle da fila de sync (outbox/inbox) — o MESMO do Sync-PG-SB (SYNC_SCHEMA).
  SYNC_SCHEMA: z.string().default('ecb_sync'),
  // Teto do corpo JSON. O default do Express é 100 kb — pequeno demais para /sync/inbox,
  // que recebe lotes do outbox das lojas (uma NFC-e com os 4 XML pesa ~25 kb). Com 100 kb
  // o push falhava com 500, o lote não era marcado como enviado e a fila NUNCA drenava.
  // 8 MB dá o dobro da folga do teto de fatia do worker (SYNC_PUSH_MAX_BYTES, 4 MiB).
  HTTP_BODY_LIMIT: z.string().default('8mb'),
  // Buckets de Storage (Fase 2 do cutover) — os MESMOS nomes que o Sync-PG-SB usava por SDK.
  STORAGE_PRODUCT_IMAGES_BUCKET: z.string().default('product-images'),
  STORAGE_NFCE_CERTIFICATES_BUCKET: z.string().default('store-certificates'),
  // Acervo de XML fiscal. COMPARTILHADO com o EasyML (NF-e 55 + CT-e): o `model` no
  // caminho é o que separa os três. Bucket privado, sem policy para `authenticated` —
  // o download é servido pela API, com o tenant do TenantGuard (ADR-0022).
  STORAGE_FISCAL_XML_BUCKET: z.string().default('fiscal-xml'),
  // Swagger UI + OpenAPI JSON em /<API_PREFIX>/docs. Ligado por padrão (a doc não
  // expõe segredo, só o contrato). Desligue com SWAGGER_ENABLED=false se não quiser
  // publicar o mapa da API numa borda aberta à internet.
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Auth máquina-a-máquina (substitui o X-Master-Key). Chave que provisiona tenants
  // e cria system_admin — exija comprimento alto.
  SERVICE_API_KEY: z.string().min(32, 'SERVICE_API_KEY deve ter ao menos 32 caracteres'),

  // Supabase cloud
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),

  // Conexão pg ao Postgres do Supabase cloud (pooler em homolog; direto/pooler em prod)
  DATABASE_URL: z.string().min(10),
  // TLS do banco: VALIDA o cert por padrão (fail-closed). Forneça DATABASE_CA_CERT (PEM do
  // CA do Supabase) p/ validação real; o cert do pooler é auto-assinado, então sem o CA
  // você teria que, conscientemente, pôr DATABASE_SSL_REJECT_UNAUTHORIZED=false.
  DATABASE_SSL_REJECT_UNAUTHORIZED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  DATABASE_CA_CERT: z.string().default(''),

  // Sessão / login (EasyML §2)
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_COOKIE_NAME: z.string().default(DEFAULT_SESSION_COOKIE_NAME),
  // 'lax' (mesma origem, default) | 'none' (SPA e API em origens diferentes — exige HTTPS) | 'strict'.
  SESSION_COOKIE_SAMESITE: z.enum(['lax', 'none', 'strict']).default('lax'),
  // Sliding-expiry: só renova quando a vida restante cai abaixo de (TTL − throttle).
  SESSION_RENEW_THROTTLE_MINUTES: z.coerce.number().int().positive().default(30),
  // Cache de sessão em memória: por quantos segundos um hit dispensa a consulta ao banco.
  // ⚠️ É por-instância: com MÚLTIPLAS instâncias, uma sessão revogada segue válida em
  // outras por até este tempo. Por isso o default é 0 (cache DESLIGADO → revogação
  // imediata, correto em qualquer topologia). Só ligue (ex.: 30) quando a API rodar
  // em instância ÚNICA, ou quando houver invalidação compartilhada (Redis/NOTIFY).
  SESSION_CACHE_SECONDS: z.coerce.number().int().nonnegative().default(0),

  // Rate-limit (contado por SESSÃO — ver SessionThrottlerGuard; anônimo cai no IP).
  // O default é generoso de propósito: uma tela de dashboard dispara dezenas de
  // chamadas em paralelo e ainda faz polling. Isto é rede de proteção contra abuso,
  // não cota de uso — apertar aqui aparece como 429 no meio de uma tela normal.
  RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_LIMIT: z.coerce.number().int().positive().default(300),

  // Cache do vínculo usuário↔empresa↔loja (TenantGuard), em segundos. 0 desliga.
  // Ligado por padrão, ao contrário do cache de SESSÃO: conceder/retirar acesso é ato
  // administrativo, não resposta a incidente — segundos de defasagem são aceitáveis, e
  // sem cache toda requisição pagaria uma ida extra ao banco só para autorizar.
  TENANT_CACHE_SECONDS: z.coerce.number().int().nonnegative().default(30),
  // anon key p/ o grant de senha do Supabase Auth; se vazia, cai na service_role.
  SUPABASE_ANON_KEY: z.string().default(''),

  // error-report-proxy → EasyGuardian (secret injetado server-side)
  //
  // Mesma dupla do SSO: `_EASYFOOD` na frente, a compartilhada como ponte. ATENÇÃO — aqui o
  // nome é só nosso: quem aceita ou recusa é o EasyGuardian, comparando o VALOR. Batizar de
  // `_EASYFOOD` um valor novo só funciona se o EasyGuardian também for ensinado a aceitá-lo.
  ERROR_REPORT_SECRET_EASYFOOD: z.string().default(''),
  ERROR_REPORT_SECRET: z.string().default(''),
  ERROR_REPORT_UPSTREAM_URL: z
    .string()
    .url()
    .default('https://ohjyqafgcxvrvbtiuvpq.supabase.co/functions/v1/error-report'),

  // sso-support → projeto Support (token HMAC; contrato externo)
  //
  // Duas chaves de propósito: `_EASYFOOD` é a chave DEDICADA deste produto e tem
  // precedência; `SSO_SHARED_SECRET` é a legada compartilhada pelos demais módulos
  // Easy* (EasyCommandPay, ...) e fica como ponte enquanto o receptor do EasyChat
  // ainda não aceita a dedicada. Assinar com a dedicada só funciona depois que a
  // function `sso` do EasyChat for publicada (no fonte do Lovable) aceitando-a.
  SSO_SHARED_SECRET_EASYFOOD: z.string().default(''),
  SSO_SHARED_SECRET: z.string().default(''),
  SUPPORT_SSO_ENDPOINT: z
    .string()
    .url()
    .default('https://puqybpgzhwaxmhedqhqu.supabase.co/functions/v1/sso'),

  // Chave-mestra sensível (AES-GCM enc:v1 + HKDF do bootstrap-code) — 32 bytes em base64.
  // MESMO valor do Electron/Sync/totens; sem ela essas rotas retornam 500.
  SENSITIVE_SECRET_MASTER_KEY_BASE64: z.string().default(''),
  SENSITIVE_SECRET_KEY_ID: z.string().default('kid-sensitive-local-aes-sync'),

  // ── Assistente de IA — porta única do ecossistema: o EasyAI (ADR-0003) ────────
  //
  // **Não existe chave de provedor de IA aqui, e isso é invariante, não omissão.** Este
  // produto não fala com a OpenAI: ele encaminha o chat para o EasyAI, que é dono da
  // credencial, da cota, do crédito e do registro de uso do ecossistema inteiro.
  //
  // Chegou a existir `OPENAI_API_KEY`/`AI_MODEL`/`AI_DAILY_FREE_LIMIT` neste arquivo. Saíram
  // porque a IA própria daqui escrevia nas MESMAS tabelas de cobrança que a porta —
  // duas réguas cobrando da mesma carteira,
  // com o mesmo cliente pagando diferente conforme o produto por onde entrasse. Se uma
  // variável dessas voltar a aparecer, é sinal de que a IA voltou a ser implementada aqui.
  EASYAI_URL: z
    .string()
    .url()
    .default('https://easyai.easysoftcloud.com.br/api/v1/chat'),
  // Segredo compartilhado com o EasyAI (mesmo valor nos dois cofres). Assina o `X-Service-Token`
  // (HMAC-SHA256) que afirma "este usuário é fulano" — a sessão daqui é token OPACO, que o EasyAI
  // não sabe validar, então repassar o header do usuário não funcionaria.
  //
  // Vazio = rota de chat responde fail-closed (503); o resto da API sobe normal.
  AI_SERVICE_SHARED_SECRET: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

/** Token de injeção do Nest para o objeto de ambiente já validado. */
export const ENV = Symbol('ENV');

/**
 * Segredos que o schema aceita vazios (para o boot não travar em dev), mas cuja ausência em
 * produção **desliga uma funcionalidade inteira em silêncio**. Devolve os nomes dos que
 * faltam, para o arranque avisar — NUNCA valores.
 *
 * Existe porque foi exatamente assim que o cofre de produção subiu em 31/07/2026: sem
 * `SSO_SHARED_SECRET*` (botão "Suporte" em 500) e sem `ERROR_REPORT_SECRET` (todo relatório
 * de erro rejeitado com 401 pelo EasyGuardian, e o browser não reclama porque é
 * fire-and-forget). Nada no boot dizia isso.
 */
export function segredosAusentes(env: Env): string[] {
  const faltando: string[] = [];
  if (!env.SSO_SHARED_SECRET_EASYFOOD && !env.SSO_SHARED_SECRET) {
    faltando.push('SSO_SHARED_SECRET_EASYFOOD/SSO_SHARED_SECRET (botão Suporte)');
  }
  if (!env.ERROR_REPORT_SECRET_EASYFOOD && !env.ERROR_REPORT_SECRET) {
    faltando.push('ERROR_REPORT_SECRET_EASYFOOD/ERROR_REPORT_SECRET (telemetria de erro)');
  }
  if (!env.SENSITIVE_SECRET_MASTER_KEY_BASE64) {
    faltando.push('SENSITIVE_SECRET_MASTER_KEY_BASE64 (segredos de emitente/TEF)');
  }
  if (!env.AI_SERVICE_SHARED_SECRET) {
    faltando.push('AI_SERVICE_SHARED_SECRET (assistente de IA)');
  }
  return faltando;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuração de ambiente inválida:\n${issues}`);
  }
  return parsed.data;
}
