import { Injectable, Logger } from '@nestjs/common';
import { resolveAppConfig, type AppConfig } from '../domain/app-registry';
import { normalizeRecoveryEmail } from '../domain/recovery-email';
import { buildDirectRecoveryLink, buildRecoveryHtml, buildRecoveryText } from '../domain/recovery-template';
import type { RecoveryInput } from '../dto/recovery.schema';
import { EasyMailClient } from '../infrastructure/easymail.client';
import { SupabaseAuthClient } from '../infrastructure/supabase-auth.client';

/**
 * Recuperação de senha (migra send-recovery-email). PÚBLICA. Defesas preservadas:
 * validação de e-mail, allowlist anti open-redirect (resolveAppConfig), e RESPOSTA
 * 200 CONSTANTE quando o e-mail não existe (não revela existência de conta).
 */
@Injectable()
export class PasswordRecoveryService {
  // O contexto continua `AuthService`: este caso de uso saiu de lá, e quem filtra o log
  // de falha de entrega por esse nome não pode passar a não achar nada.
  private readonly log = new Logger('AuthService');

  constructor(
    private readonly authClient: SupabaseAuthClient,
    private readonly mail: EasyMailClient,
  ) {}

  async sendRecoveryEmail(payload: RecoveryInput): Promise<{ status: number; body: unknown }> {
    const email = normalizeRecoveryEmail(payload.email);
    // 400 só p/ erro de FORMATO da requisição (não revela existência de conta).
    if (!email) {
      return { status: 400, body: { error: 'Email inválido' } };
    }
    const resolved = resolveAppConfig(payload);
    if (!resolved.ok) return { status: 400, body: { error: resolved.error } };

    // Entrega em BACKGROUND → resposta CONSTANTE e imediata: mesmo corpo/status/tempo
    // exista ou não a conta (fecha enumeração por corpo, status 502 e timing).
    void this.deliverRecovery(email, resolved.cfg).catch((e) =>
      this.log.warn(`recovery: falha na entrega (e-mail redigido): ${e instanceof Error ? e.message : String(e)}`),
    );
    return { status: 200, body: { ok: true } };
  }

  /** Gera o link (Auth admin) e envia via EasyMail. Rodado fora do caminho da resposta. */
  private async deliverRecovery(email: string, cfg: AppConfig): Promise<void> {
    const hashed = await this.authClient.generateRecoveryHash(email);
    if (!hashed) return; // conta inexistente / erro: silencioso (privacidade)

    const actionLink = buildDirectRecoveryLink(cfg.resetUrl, hashed);
    await this.mail.send({
      to_email: email,
      subject: cfg.subject,
      body_html: buildRecoveryHtml(actionLink, email, cfg),
      body_text: buildRecoveryText(actionLink, email, cfg),
      priority: 2,
      source: cfg.source,
    });
  }
}
