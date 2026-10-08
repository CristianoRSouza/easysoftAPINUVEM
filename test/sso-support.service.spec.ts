import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import { AuthService } from '../src/modules/auth/application/auth.service';
import { SupabaseAuthClient } from '../src/modules/auth/infrastructure/supabase-auth.client';
import type { ServiceRole } from '../src/db/service-role';
import type { SessionService } from '../src/db/session.service';
import type { SupabaseAdmin } from '../src/db/supabase-admin';
import type { Env } from '../src/config/env';

const USER = '44444444-4444-4444-8444-444444444444';
const LEGADA = 'a'.repeat(64);
const DEDICADA = 'b'.repeat(64);
const ENDPOINT = 'https://puqybpgzhwaxmhedqhqu.supabase.co/functions/v1/sso';

const serviceRole = { run: (_r: string, fn: any) => fn() } as unknown as ServiceRole;
const sessions = {} as unknown as SessionService;

const supaWith = (email: string | null, meta: Record<string, unknown> = {}) =>
  ({
    client: { auth: { admin: { getUserById: async () => ({ data: { user: { email, user_metadata: meta } } }) } } },
  }) as unknown as SupabaseAdmin;

const svc = (env: Partial<Env>, email: string | null = 'dono@easysoft.com.br', meta = {}) => {
  const fullEnv = {
    SUPPORT_SSO_ENDPOINT: ENDPOINT,
    ...env,
  } as Env;
  return new AuthService(
    new SupabaseAuthClient(serviceRole, supaWith(email, meta), fullEnv),
    serviceRole,
    sessions,
    fullEnv,
  );
};

/** Refaz a conta do receptor: HMAC-SHA256 sobre o payload em base64url. */
const assina = (payloadStr: string, segredo: string) =>
  crypto.createHmac('sha256', segredo).update(payloadStr).digest('base64url');

describe('AuthService.ssoSupport — chave dedicada do EasyFood com ponte para a legada', () => {
  it('sem nenhuma chave configurada: falha fechado com 500 sso_not_configured', async () => {
    await expect(svc({ SSO_SHARED_SECRET: '', SSO_SHARED_SECRET_EASYFOOD: '' }).ssoSupport(USER)).rejects.toMatchObject(
      { response: { error: 'sso_not_configured' } },
    );
  });

  it('só a legada no ambiente: assina com a legada (ponte até o cofre/receptor terem a dedicada)', async () => {
    const out = await svc({ SSO_SHARED_SECRET: LEGADA, SSO_SHARED_SECRET_EASYFOOD: '' }).ssoSupport(USER);
    const [payloadStr, sig] = out.token.split('.');
    expect(sig).toBe(assina(payloadStr, LEGADA));
  });

  it('dedicada presente: ela tem precedência, mesmo com a legada configurada junto', async () => {
    const out = await svc({ SSO_SHARED_SECRET: LEGADA, SSO_SHARED_SECRET_EASYFOOD: DEDICADA }).ssoSupport(USER);
    const [payloadStr, sig] = out.token.split('.');
    expect(sig).toBe(assina(payloadStr, DEDICADA));
    expect(sig).not.toBe(assina(payloadStr, LEGADA));
  });

  it('formato do token é IMUTÁVEL — é contrato com o projeto Support', async () => {
    const out = await svc({ SSO_SHARED_SECRET_EASYFOOD: DEDICADA }, 'dono@easysoft.com.br', {
      full_name: 'Dona da Loja',
    }).ssoSupport(USER);
    const [payloadStr] = out.token.split('.');
    const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8'));

    expect(payload).toMatchObject({
      email: 'dono@easysoft.com.br',
      name: 'Dona da Loja',
      source_user_id: USER,
      iss: 'easycommandpay',
    });
    expect(payload.exp - payload.iat).toBe(120);
    expect(out.redirect_url).toBe(`${ENDPOINT}?token=${encodeURIComponent(out.token)}`);
  });

  it('usuário sem e-mail: 401, nunca um token assinado sem identidade', async () => {
    await expect(svc({ SSO_SHARED_SECRET_EASYFOOD: DEDICADA }, null).ssoSupport(USER)).rejects.toMatchObject({
      response: { error: 'unauthorized' },
    });
  });
});
