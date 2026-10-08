import type { AppConfig } from './app-registry';

/** Escapa texto para interpolação segura em HTML/atributos (anti-injeção no e-mail). */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Link direto pro domínio do app (não usa /auth/v1/verify — evita Site URL). */
export function buildDirectRecoveryLink(resetUrl: string, tokenHash: string): string {
  const url = new URL(resetUrl);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', 'recovery');
  return url.toString();
}

export function buildRecoveryText(actionLink: string, email: string, cfg: AppConfig): string {
  return (
    `Recebemos um pedido para redefinir a senha da conta ${email} no ${cfg.appName}.\n\n` +
    `Acesse o link abaixo para criar uma nova senha (expira em 1 hora):\n${actionLink}\n\n` +
    `Se você não solicitou esta alteração, ignore este email.`
  );
}

export function buildRecoveryHtml(actionLink: string, recipientEmail: string, cfg: AppConfig): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#0f172a;font-family:'Manrope',Arial,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#111c34;border:1px solid #1e293b;border-radius:12px;padding:32px;">
            <tr><td style="font-family:'Sora',Arial,sans-serif;font-size:22px;font-weight:700;color:#ffffff;padding-bottom:12px;">
              Redefinição de senha
            </td></tr>
            <tr><td style="font-size:14px;line-height:22px;color:#cbd5e1;padding-bottom:20px;">
              Olá,<br/><br/>
              Recebemos um pedido para redefinir a senha da conta <strong style="color:#ffffff;">${esc(recipientEmail)}</strong>
              no <strong style="color:#ffffff;">${esc(cfg.appName)}</strong>.<br/><br/>
              Clique no botão abaixo para criar uma nova senha. Este link expira em 1 hora.
            </td></tr>
            <tr><td align="center" style="padding:8px 0 24px 0;">
              <a href="${esc(actionLink)}" style="display:inline-block;background:${esc(cfg.brandColor)};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">
                Redefinir senha
              </a>
            </td></tr>
            <tr><td style="font-size:12px;line-height:18px;color:#94a3b8;padding-bottom:8px;">
              Se o botão não funcionar, copie e cole este endereço no navegador:<br/>
              <span style="color:#cbd5e1;word-break:break-all;">${esc(actionLink)}</span>
            </td></tr>
            <tr><td style="font-size:12px;line-height:18px;color:#64748b;border-top:1px solid #1e293b;padding-top:16px;margin-top:16px;">
              Se você não solicitou esta alteração, pode ignorar este email — a senha permanece a mesma.
            </td></tr>
          </table>
          <div style="font-size:11px;color:#475569;margin-top:16px;">${esc(cfg.brandFooter)}</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
