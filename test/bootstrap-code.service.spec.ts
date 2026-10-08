import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'crypto';
import { StoresService } from '../src/modules/stores/application/stores.service';
import { StoreAdminRepository } from '../src/common/tenant/store-admin.repository';
import type { DbService } from '../src/db/db.service';
import type { ServiceRole } from '../src/db/service-role';
import type { Env } from '../src/config/env';

/**
 * O código de primeiro acesso (`EFB1`) — o contrato que NINGUÉM estava fixando.
 *
 * ── Por que este arquivo existe ────────────────────────────────────────────────
 * São três os formatos que o projeto declara IMUTÁVEIS, porque um sistema de fora
 * depende deles byte a byte. Dois já tinham teste: o envelope `enc:v1` do TEF
 * (`totem-write.service.spec.ts`) e o token SSO (`sso-support.service.spec.ts`). Este
 * não tinha nenhum — o único teste que importava o `StoresService` checava a regra de
 * quem pode administrar a loja, não o formato.
 *
 * E é justamente o pior para ficar descoberto, por três motivos que se somam:
 *
 *   1. quem verifica é a Admin-API da loja, OFFLINE — a quebra aparece numa instalação
 *      nova de PDV com internet instável, que é o cenário que este código existe para
 *      resolver;
 *   2. nada é gravado no banco (não há como reemitir "o mesmo" código), então não sobra
 *      nem com o que comparar depois;
 *   3. mudar a string do HKDF, o prefixo ou o que entra no HMAC produz um código com
 *      forma VÁLIDA e assinatura que a loja recusa. Passa em typecheck, passa em build,
 *      passa nos outros testes.
 *
 * Por isso os testes abaixo **refazem a conta por fora**, como o receptor faz, em vez de
 * comparar com o que o próprio service produziu. Um teste que chama o método e confere o
 * resultado contra o mesmo método não fixa formato nenhum.
 */

const ADMIN = '11111111-1111-4111-8111-111111111111';
const LOJA = '33333333-3333-4333-8333-333333333333';
const MASTER = Buffer.alloc(32, 7).toString('base64');

/** O contrato, escrito aqui à mão. Se mudar no service, tem que mudar aqui — de propósito. */
const HKDF_INFO = 'easyfood/bootstrap-code/v1';
const PREFIXO = 'EFB1';

/** Refaz a derivação e a assinatura como a Admin-API da loja faria. */
function conferirComoALoja(code: string, masterB64: string) {
  const [prefixo, payloadB64, sig] = code.split('.');
  const master = Buffer.from(masterB64, 'base64');
  const derived = Buffer.from(
    crypto.hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(HKDF_INFO), 32),
  );
  const esperada = crypto
    .createHmac('sha256', derived)
    .update(`${prefixo}.${payloadB64}`)
    .digest('base64url');
  return {
    prefixo,
    payload: JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')),
    assinaturaConfere: sig === esperada,
  };
}

const db = (podeAdministrar: boolean) =>
  ({ query: vi.fn(async () => ({ rows: [{ ok: podeAdministrar }] })) }) as unknown as DbService;

const serviceRole = { run: (_r: string, fn: any) => fn() } as unknown as ServiceRole;

const svc = (opts: { admin?: boolean; master?: string } = {}) =>
  new StoresService(new StoreAdminRepository(db(opts.admin ?? true), serviceRole), {
    SENSITIVE_SECRET_MASTER_KEY_BASE64: opts.master ?? MASTER,
  } as Env);

describe('StoresService.issueBootstrapCode — formato imutável do EFB1', () => {
  it('a loja consegue verificar o código offline: prefixo, 3 partes e assinatura conferem', async () => {
    const out = await svc().issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br');

    expect(out.code.split('.')).toHaveLength(3);
    const conferido = conferirComoALoja(out.code, MASTER);
    expect(conferido.prefixo).toBe(PREFIXO);
    expect(conferido.assinaturaConfere).toBe(true);
  });

  it('o payload tem exatamente as 5 chaves do contrato — nem a mais, nem a menos', async () => {
    const out = await svc().issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br');
    const { payload } = conferirComoALoja(out.code, MASTER);

    // `toEqual` nas chaves, não `toMatchObject`: campo NOVO no payload também quebra o
    // receptor, e um teste que só checa presença deixaria isso passar.
    expect(Object.keys(payload).sort()).toEqual(['em', 'exp', 'jti', 'sid', 'v']);
    expect(payload.v).toBe(1);
    expect(payload.em).toBe('dono@easysoft.com.br');
    expect(payload.sid).toBe(LOJA);
  });

  it('o que é assinado inclui o PREFIXO, não só o payload', async () => {
    const out = await svc().issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br');
    const [, payloadB64, sig] = out.code.split('.');
    const derived = Buffer.from(
      crypto.hkdfSync('sha256', Buffer.from(MASTER, 'base64'), Buffer.alloc(0), Buffer.from(HKDF_INFO), 32),
    );

    // A armadilha clássica de reimplementar: assinar só o payload. Daria um código com a
    // mesma cara e assinatura errada — e a loja recusaria sem dizer por quê.
    const soOPayload = crypto.createHmac('sha256', derived).update(payloadB64).digest('base64url');
    expect(sig).not.toBe(soOPayload);
    expect(sig).toBe(
      crypto.createHmac('sha256', derived).update(`${PREFIXO}.${payloadB64}`).digest('base64url'),
    );
  });

  it('a string do HKDF faz parte do contrato: derivar com outra `info` não valida', async () => {
    const out = await svc().issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br');
    const [, payloadB64, sig] = out.code.split('.');
    const outraInfo = Buffer.from(
      crypto.hkdfSync('sha256', Buffer.from(MASTER, 'base64'), Buffer.alloc(0), Buffer.from('easyfood/bootstrap-code/v2'), 32),
    );

    expect(sig).not.toBe(
      crypto.createHmac('sha256', outraInfo).update(`${PREFIXO}.${payloadB64}`).digest('base64url'),
    );
  });

  it('master key diferente não valida — a assinatura é o que prende o código à chave', async () => {
    const out = await svc().issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br');
    const outraMaster = Buffer.alloc(32, 9).toString('base64');
    expect(conferirComoALoja(out.code, outraMaster).assinaturaConfere).toBe(false);
  });

  it('cada emissão tem `jti` próprio: não há como reemitir "o mesmo" código', async () => {
    const s = svc();
    const a = await s.issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br');
    const b = await s.issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br');
    expect(conferirComoALoja(a.code, MASTER).payload.jti).not.toBe(
      conferirComoALoja(b.code, MASTER).payload.jti,
    );
  });
});

describe('StoresService.issueBootstrapCode — TTL', () => {
  const expEmHoras = (code: string) => {
    const { payload } = conferirComoALoja(code, MASTER);
    return Math.round((payload.exp - Math.floor(Date.now() / 1000)) / 3600);
  };

  it('sem ttl_hours: 48h (o default)', async () => {
    const out = await svc().issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br');
    expect(expEmHoras(out.code)).toBe(48);
  });

  it('acima do teto: reduz para 72h em SILÊNCIO (não é erro)', async () => {
    const out = await svc().issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br', 9999);
    expect(expEmHoras(out.code)).toBe(72);
  });

  it.each([
    ['zero', 0],
    ['negativo', -5],
    ['não-numérico', Number.NaN],
  ])('ttl %s cai no default de 48h', async (_nome, ttl) => {
    const out = await svc().issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br', ttl as number);
    expect(expEmHoras(out.code)).toBe(48);
  });

  it('`expires_at` da resposta corresponde ao `exp` assinado', async () => {
    const out = await svc().issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br');
    const { payload } = conferirComoALoja(out.code, MASTER);
    expect(out.expires_at).toBe(new Date(payload.exp * 1000).toISOString());
  });
});

describe('StoresService.issueBootstrapCode — entrada e autorização', () => {
  it('normaliza o e-mail (apara e baixa a caixa) ANTES de assinar', async () => {
    const out = await svc().issueBootstrapCode(ADMIN, LOJA, '  DONO@EasySoft.com.BR  ');
    expect(out.email).toBe('dono@easysoft.com.br');
    expect(conferirComoALoja(out.code, MASTER).payload.em).toBe('dono@easysoft.com.br');
  });

  it('e-mail inválido → 400 invalid_email', async () => {
    await expect(svc().issueBootstrapCode(ADMIN, LOJA, 'nao-e-email')).rejects.toMatchObject({
      response: { error: 'invalid_email' },
    });
  });

  it('store_id fora do formato UUID → 400 invalid_store', async () => {
    await expect(svc().issueBootstrapCode(ADMIN, 'loja-1', 'dono@easysoft.com.br')).rejects.toMatchObject({
      response: { error: 'invalid_store' },
    });
  });

  it('quem não administra a loja leva 403 — e nenhum código é emitido', async () => {
    await expect(
      svc({ admin: false }).issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br'),
    ).rejects.toMatchObject({ response: { error: 'forbidden' } });
  });

  it('a autorização é consultada ANTES de assinar (não se cifra para depois negar)', async () => {
    const consulta = vi.fn(async () => ({ rows: [{ ok: false }] }));
    const s = new StoresService(
      new StoreAdminRepository({ query: consulta } as unknown as DbService, serviceRole),
      { SENSITIVE_SECRET_MASTER_KEY_BASE64: MASTER } as Env,
    );
    await expect(s.issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br')).rejects.toMatchObject({
      response: { error: 'forbidden' },
    });
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it('a rota NÃO grava nada: a única ida ao banco é a de autorização', async () => {
    const consulta = vi.fn(async () => ({ rows: [{ ok: true }] }));
    const s = new StoresService(
      new StoreAdminRepository({ query: consulta } as unknown as DbService, serviceRole),
      { SENSITIVE_SECRET_MASTER_KEY_BASE64: MASTER } as Env,
    );
    await s.issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br');

    expect(consulta).toHaveBeenCalledTimes(1);
    const sql = String(consulta.mock.calls[0][0]).toLowerCase();
    expect(sql).not.toMatch(/insert|update|delete/);
  });
});

describe('StoresService.issueBootstrapCode — chave-mestra ausente ou fraca', () => {
  it('sem master key → 500 not_configured (nunca emite código sem assinar de verdade)', async () => {
    await expect(
      svc({ master: '' }).issueBootstrapCode(ADMIN, LOJA, 'dono@easysoft.com.br'),
    ).rejects.toMatchObject({ response: { error: 'not_configured' } });
  });

  it('master key com tamanho ≠ 32 bytes → 500 bad_key, não uma cifra fraca', async () => {
    await expect(
      svc({ master: Buffer.alloc(16, 7).toString('base64') }).issueBootstrapCode(
        ADMIN,
        LOJA,
        'dono@easysoft.com.br',
      ),
    ).rejects.toMatchObject({ response: { error: 'bad_key' } });
  });
});
