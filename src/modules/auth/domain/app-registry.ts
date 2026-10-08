// Registry de apps para o fluxo de recovery (portado da edge function
// send-recovery-email/app-registry.ts). Resolve domínio + branding por app e
// impõe a allowlist anti open-redirect. FORMATO/regras preservados.

export interface AppConfig {
  resetUrl: string;
  appName: string;
  brandFooter: string;
  brandColor: string;
  source: string;
  subject: string;
}

/**
 * ⚠️ Este `resetUrl` é o endereço que vai DENTRO do e-mail de redefinição.
 *
 * Se o front mudar de domínio e esta linha não mudar junto, cada pedido de "esqueci a
 * senha" manda a pessoa para um endereço que não existe mais — e ela fica trancada para
 * fora sem nenhum erro aparecer para ninguém. É o tipo de quebra que só se descobre pelo
 * suporte, dias depois.
 *
 * `MANAGER_RESET_URL` existe para essa troca poder acontecer no MESMO deploy do front,
 * em vez de depender de um commit chegar na hora certa. Sem a variável, vale o padrão.
 */
export const APP_REGISTRY: Record<string, AppConfig> = {
  manager: {
    resetUrl:
      process.env.MANAGER_RESET_URL?.trim() ||
      'https://easymanager.easysoftcloud.com.br/reset-password',
    appName: 'EasyCommandPay Manager',
    brandFooter: 'EasySoft · EasyCommandPay',
    brandColor: '#3B8EE8',
    source: 'manager-web/reset-password',
    subject: 'Redefinição de senha — EasyCommandPay Manager',
  },
};

export const DEFAULT_APP_KEY = 'manager';

/**
 * Allowlist de hosts para `redirect_to` custom (anti open-redirect).
 * ⚠️ NÃO incluir hosts multi-tenant públicos (ex.: *.lovable.app) — permitiria a
 * captura do token de reset via redirect para um subdomínio de atacante.
 */
export const ALLOWED_REDIRECT_HOSTS: RegExp[] = [
  /\.easysoftcloud\.com\.br$/i,
  /^easysoftcloud\.com\.br$/i,
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export type ResolveResult = { ok: true; cfg: AppConfig } | { ok: false; error: string };

interface ResolveInput {
  app?: string;
  redirect_to?: string;
  app_name?: string;
  subject?: string;
  source?: string;
  brand_color?: string;
}

function isRedirectAllowed(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  return ALLOWED_REDIRECT_HOSTS.some((rx) => rx.test(url.hostname));
}

/**
 * Precedência: (1) redirect_to explícito validado contra a allowlist →
 * (2) lookup por `app` → (3) DEFAULT_APP_KEY.
 */
export function resolveAppConfig(input: ResolveInput): ResolveResult {
  if (input.redirect_to) {
    let parsed: URL;
    try {
      parsed = new URL(input.redirect_to);
    } catch {
      return { ok: false, error: 'redirect_to inválido' };
    }
    if (!isRedirectAllowed(parsed)) {
      return { ok: false, error: 'Domínio de redirect_to não autorizado' };
    }
    const appName = (input.app_name?.trim() || parsed.hostname).slice(0, 80);
    const brandColor = input.brand_color && HEX_COLOR.test(input.brand_color) ? input.brand_color : '#3B8EE8';
    return {
      ok: true,
      cfg: {
        resetUrl: parsed.toString(),
        appName,
        brandFooter: `EasySoft · ${appName}`,
        brandColor,
        source: input.source || `custom/${parsed.hostname}`,
        subject: input.subject || `Redefinição de senha — ${appName}`,
      },
    };
  }

  const key = (input.app || DEFAULT_APP_KEY).toLowerCase();
  const base = APP_REGISTRY[key];
  if (!base) {
    return { ok: false, error: `App desconhecido: ${key}` };
  }
  const overrideColor = input.brand_color && HEX_COLOR.test(input.brand_color) ? input.brand_color : base.brandColor;
  return {
    ok: true,
    cfg: {
      ...base,
      subject: input.subject || base.subject,
      source: input.source || base.source,
      brandColor: overrideColor,
    },
  };
}
