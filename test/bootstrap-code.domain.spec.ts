import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import {
  DEFAULT_TTL_HOURS,
  EMAIL_RE,
  MAX_TTL_HOURS,
  expiresAtSeconds,
  resolveTtlHours,
  signBootstrapCode,
  type BootstrapCodePayload,
} from '../src/modules/stores/domain/bootstrap-code';

/**
 * As regras puras do código de primeiro acesso. O formato de ponta a ponta já é fixado em
 * `bootstrap-code.service.spec.ts`; aqui ficam os casos de borda que não dependem de
 * relógio, sorteio nem banco.
 */

const MASTER = Buffer.alloc(32, 7);
const PAYLOAD: BootstrapCodePayload = {
  v: 1,
  em: 'dono@easysoft.com.br',
  sid: '33333333-3333-4333-8333-333333333333',
  exp: 1_800_000_000,
  jti: '55555555-5555-4555-8555-555555555555',
};

describe('resolveTtlHours', () => {
  it.each([
    ['ausente', undefined],
    ['null', null],
    ['zero', 0],
    ['negativo', -1],
    ['NaN', Number.NaN],
    ['texto', 'abc'],
    ['infinito', Number.POSITIVE_INFINITY],
  ])('%s cai no default', (_nome, raw) => {
    expect(resolveTtlHours(raw)).toBe(DEFAULT_TTL_HOURS);
  });

  it('valor dentro do intervalo é respeitado, inclusive fracionário', () => {
    expect(resolveTtlHours(1)).toBe(1);
    expect(resolveTtlHours(0.5)).toBe(0.5);
    expect(resolveTtlHours(MAX_TTL_HOURS)).toBe(MAX_TTL_HOURS);
  });

  it('acima do teto é reduzido ao teto', () => {
    expect(resolveTtlHours(MAX_TTL_HOURS + 0.01)).toBe(MAX_TTL_HOURS);
    expect(resolveTtlHours(9999)).toBe(MAX_TTL_HOURS);
  });
});

describe('expiresAtSeconds', () => {
  it('soma as horas em segundos', () => {
    expect(expiresAtSeconds(1000, 48)).toBe(1000 + 48 * 3600);
  });

  it('hora fracionária arredonda para BAIXO no segundo', () => {
    expect(expiresAtSeconds(0, 0.0005)).toBe(1); // 1,8s → 1
  });
});

describe('signBootstrapCode', () => {
  it('é determinístico: mesma entrada, mesmo código', () => {
    expect(signBootstrapCode(PAYLOAD, MASTER)).toBe(signBootstrapCode(PAYLOAD, MASTER));
  });

  it('o payload vai em base64url do JSON, com as chaves na ordem do contrato', () => {
    const [prefixo, encoded] = signBootstrapCode(PAYLOAD, MASTER).split('.');
    expect(prefixo).toBe('EFB1');
    expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe(
      '{"v":1,"em":"dono@easysoft.com.br","sid":"33333333-3333-4333-8333-333333333333",' +
        '"exp":1800000000,"jti":"55555555-5555-4555-8555-555555555555"}',
    );
  });

  it('a assinatura é HMAC-SHA256 com a chave derivada por HKDF, sobre prefixo + payload', () => {
    const [prefixo, encoded, sig] = signBootstrapCode(PAYLOAD, MASTER).split('.');
    const derived = Buffer.from(
      crypto.hkdfSync('sha256', MASTER, Buffer.alloc(0), Buffer.from('easyfood/bootstrap-code/v1'), 32),
    );
    expect(sig).toBe(crypto.createHmac('sha256', derived).update(`${prefixo}.${encoded}`).digest('base64url'));
  });

  it('mudar um campo do payload muda a assinatura', () => {
    const a = signBootstrapCode(PAYLOAD, MASTER).split('.')[2];
    const b = signBootstrapCode({ ...PAYLOAD, exp: PAYLOAD.exp + 1 }, MASTER).split('.')[2];
    expect(a).not.toBe(b);
  });
});

describe('EMAIL_RE', () => {
  it('aceita o formato mínimo e recusa o que não tem @, domínio ou tem espaço', () => {
    expect(EMAIL_RE.test('a@b.c')).toBe(true);
    expect(EMAIL_RE.test('sem-arroba')).toBe(false);
    expect(EMAIL_RE.test('a@semponto')).toBe(false);
    expect(EMAIL_RE.test('a b@c.d')).toBe(false);
  });
});
