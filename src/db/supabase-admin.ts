import { Inject, Injectable } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV, type Env } from '../config/env';

/**
 * Cliente Supabase com a chave service_role — para o Auth admin (GoTrue) e o Storage
 * (upload de imagens/PFX, Fase 2), serviços que não são transacionáveis junto ao banco.
 * Nunca vai ao browser (§7.1). Toda chamada passa pelo chokepoint (motivos 'auth-admin' / 'storage').
 */
@Injectable()
export class SupabaseAdmin {
  readonly client: SupabaseClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
}
