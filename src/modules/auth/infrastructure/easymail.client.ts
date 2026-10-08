import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../../config/env';

/** Corpo que a edge function `send-easymail` espera — nomes e ordem como vão no fio. */
export interface EasyMailMessage {
  to_email: string;
  subject: string;
  body_html: string;
  body_text: string;
  priority: number;
  source: string;
}

/** Envio de e-mail pelo EasyMail (edge function `send-easymail`, autenticada com a service_role). */
@Injectable()
export class EasyMailClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Falha de envio sobe como `Error` — quem chama decide se loga ou engole. */
  async send(message: EasyMailMessage): Promise<void> {
    const sendRes = await fetch(`${this.env.SUPABASE_URL}/functions/v1/send-easymail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: this.env.SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify(message),
    });
    if (!sendRes.ok) throw new Error(`send-easymail ${sendRes.status}`);
    await sendRes.text();
  }
}
