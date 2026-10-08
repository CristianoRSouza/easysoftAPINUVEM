import { beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import { SessionThrottlerGuard } from '../src/common/guards/session-throttler.guard';

/**
 * O que este teste protege: a cota de rate-limit deixou de ser por IP e passou a ser
 * por SESSÃO. Se alguém reverter isso sem querer, dois usuários atrás do mesmo NAT
 * voltam a dividir a mesma cota e um derruba o outro com 429 no meio de uma tela normal.
 *
 * O guard é instanciado sem as dependências do Nest (só `getTracker` é exercitado);
 * por isso o cast — nada aqui toca storage/reflector.
 */
const guard = new (SessionThrottlerGuard as any)() as SessionThrottlerGuard;
const track = (req: Record<string, any>) => (guard as any).getTracker(req) as Promise<string>;
const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

describe('SessionThrottlerGuard — cota por sessão, não por IP', () => {
  beforeEach(() => {
    delete process.env.SESSION_COOKIE_NAME;
  });

  it('usa o cookie de sessão como chave', async () => {
    const t = await track({ cookies: { easyfood_session: 'tok-abc' }, headers: {} });
    expect(t).toBe(`s:${sha('tok-abc')}`);
  });

  it('respeita SESSION_COOKIE_NAME customizado', async () => {
    process.env.SESSION_COOKIE_NAME = 'outro_nome';
    const t = await track({ cookies: { outro_nome: 'tok-abc' }, headers: {} });
    expect(t).toBe(`s:${sha('tok-abc')}`);
  });

  it('usa o Bearer opaco quando não há cookie (cliente não-browser)', async () => {
    const t = await track({ cookies: {}, headers: { authorization: 'Bearer tok-xyz' } });
    expect(t).toBe(`s:${sha('tok-xyz')}`);
  });

  it('cookie e Bearer com o MESMO token dão a mesma chave (é a mesma sessão)', async () => {
    const viaCookie = await track({ cookies: { easyfood_session: 'mesmo' }, headers: {} });
    const viaBearer = await track({ cookies: {}, headers: { authorization: 'Bearer mesmo' } });
    expect(viaCookie).toBe(viaBearer);
  });

  it('duas sessões no MESMO IP não compartilham cota (o bug que motivou a troca)', async () => {
    const ip = '203.0.113.10';
    const a = await track({ cookies: { easyfood_session: 'user-a' }, headers: {}, ip });
    const b = await track({ cookies: { easyfood_session: 'user-b' }, headers: {}, ip });
    expect(a).not.toBe(b);
  });

  it('chamada máquina-a-máquina conta pela X-Service-Key', async () => {
    const t = await track({ cookies: {}, headers: { 'x-service-key': 'svc-key' } });
    expect(t).toBe(`k:${sha('svc-key')}`);
  });

  it('nunca devolve o token em claro (só o hash)', async () => {
    const t = await track({ cookies: { easyfood_session: 'segredo-em-claro' }, headers: {} });
    expect(t).not.toContain('segredo-em-claro');
  });

  it('anônimo cai no IP — é o que mantém login/recovery protegidos contra força bruta', async () => {
    const t = await track({ cookies: {}, headers: {}, ips: [], ip: '198.51.100.7' });
    expect(t).not.toMatch(/^[sk]:/);
    expect(t).toContain('198.51.100.7');
  });
});
