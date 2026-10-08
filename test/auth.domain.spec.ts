import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import { normalizeRecoveryEmail } from '../src/modules/auth/domain/recovery-email';
import { signSsoSupportToken, ssoDisplayName, ssoRedirectUrl } from '../src/modules/auth/domain/sso-token';

/** Regras puras da identidade: nome exibido no SSO, formato do token e e-mail de recuperação. */

const USER = '44444444-4444-4444-8444-444444444444';
const SEGREDO = 'b'.repeat(64);

describe('ssoDisplayName', () => {
  it('full_name vence name, que vence o que vem antes do @', () => {
    expect(ssoDisplayName({ full_name: 'Dona da Loja', name: 'Dona' }, 'dono@x.com')).toBe('Dona da Loja');
    expect(ssoDisplayName({ name: 'Dona' }, 'dono@x.com')).toBe('Dona');
    expect(ssoDisplayName({}, 'dono@x.com')).toBe('dono');
  });

  it('metadado em branco não conta como nome', () => {
    expect(ssoDisplayName({ full_name: '', name: '' }, 'dono@x.com')).toBe('dono');
  });

  it('sem nada antes do @: "Usuário"', () => {
    expect(ssoDisplayName({}, '@x.com')).toBe('Usuário');
  });
});

describe('signSsoSupportToken', () => {
  const identidade = { email: 'dono@easysoft.com.br', name: 'Dona da Loja', userId: USER };

  it('payload com as chaves NA ORDEM do contrato e validade de 120s', () => {
    const [payloadStr] = signSsoSupportToken(identidade, 1_000, SEGREDO).split('.');
    expect(Buffer.from(payloadStr, 'base64url').toString('utf8')).toBe(
      `{"email":"dono@easysoft.com.br","name":"Dona da Loja","source_user_id":"${USER}",` +
        '"iat":1000,"exp":1120,"iss":"easycommandpay"}',
    );
  });

  it('assinatura é HMAC-SHA256 em base64url sobre o payload já codificado', () => {
    const [payloadStr, sig] = signSsoSupportToken(identidade, 1_000, SEGREDO).split('.');
    expect(sig).toBe(crypto.createHmac('sha256', SEGREDO).update(payloadStr).digest('base64url'));
  });

  it('são exatamente duas partes separadas por ponto', () => {
    expect(signSsoSupportToken(identidade, 1_000, SEGREDO).split('.')).toHaveLength(2);
  });
});

describe('ssoRedirectUrl', () => {
  it('o token vai URL-encoded na query', () => {
    expect(ssoRedirectUrl('https://support.example/sso', 'a+b/c=.d')).toBe(
      'https://support.example/sso?token=a%2Bb%2Fc%3D.d',
    );
  });
});

describe('normalizeRecoveryEmail', () => {
  it('apara e baixa a caixa', () => {
    expect(normalizeRecoveryEmail('  DONO@EasySoft.com.BR ')).toBe('dono@easysoft.com.br');
  });

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['só espaços', '   '],
    ['sem @', 'dono.easysoft.com.br'],
    ['sem ponto no domínio', 'dono@easysoft'],
    ['com espaço no meio', 'do no@easysoft.com.br'],
  ])('%s: formato inválido vira null', (_nome, raw) => {
    expect(normalizeRecoveryEmail(raw)).toBeNull();
  });
});
