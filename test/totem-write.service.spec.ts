import { describe, expect, it, vi } from 'vitest';
import { TotemWriteService } from '../src/modules/devices/application/totem-write.service';
import { TotemLicensesRepository } from '../src/modules/devices/infrastructure/totem-licenses.repository';
import { TotemsRepository } from '../src/modules/devices/infrastructure/totems.repository';
import { decryptEnvelopeV1 } from '../src/common/crypto/envelope';
import type { DbService } from '../src/db/db.service';

/**
 * Criação e edição de totem — o payload grande, a cifra dos segredos e a licença.
 *
 * Três erros aqui não dão erro na tela: gravam.
 *   • segredo TEF apagado sem ninguém pedir → o totem para de cobrar no cartão;
 *   • totem demo salvo em produção → nota fiscal de verdade saindo de uma instalação de teste;
 *   • `is_active` gravado direto na tabela → fura o gatilho que exige licença no totem ativo.
 */

const COMPANY = '11111111-1111-4111-8111-111111111111';
const STORE = '33333333-3333-4333-8333-333333333333';
const TOTEM = '99999999-9999-4999-8999-999999999999';
const LICENCA = '77777777-7777-4777-8777-777777777777';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Chave de 32 bytes só para o teste — não é, e nunca foi, chave de ambiente nenhum. */
const ENV_FAKE = {
  SENSITIVE_SECRET_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
  SENSITIVE_SECRET_KEY_ID: 'kid-de-teste',
} as any;

function fakeTx(respostas: any[][] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows: respostas[i++] ?? [] };
    }),
  };
  const db = {
    query: client.query,
    withTransaction: vi.fn(async (fn: any) => fn(client)),
    withClaims: vi.fn(async (_c: any, fn: any) => fn(client)),
  } as unknown as DbService;
  const svc = new TotemWriteService(
    new TotemsRepository(db),
    new TotemLicensesRepository(db),
    ENV_FAKE,
  );
  return { calls, db, svc };
}

const CRIADO = [{ id: TOTEM }];
const ATUALIZADO = [{ id: TOTEM }];
const DEMO = [{ license_type: null, plan_slug: 'ecp-demo' }];
const REAL = [{ license_type: 'yearly', plan_slug: 'pro' }];

/** O UPDATE da tabela, entre as várias queries da transação. */
const acharUpdate = (calls: Array<{ sql: string; params: unknown[] }>) =>
  calls.find((c) => c.sql.includes('update public.vw_devices_totem_config'));

describe('totem — criação e edição', () => {
  describe('o tenant e a ativação', () => {
    it('company_id e store_id saem da SESSÃO, não do corpo', async () => {
      const { svc, calls } = fakeTx([CRIADO, []]);
      await svc.createTotem(COMPANY, STORE, { totem_name: 'Totem 1' }, USER);
      expect(calls[0].sql).toContain(
        'insert into public.vw_devices_totem_config (company_id, store_id',
      );
      expect(calls[0].params[0]).toBe(COMPANY);
      expect(calls[0].params[1]).toBe(STORE);
    });

    it('nasce INATIVO mesmo pedindo ativo — e avisa que falta ativar', async () => {
      const { svc, calls } = fakeTx([CRIADO, []]);
      const r = await svc.createTotem(COMPANY, STORE, { totem_name: 'T', is_active: true }, USER);
      // O gatilho do banco recusa totem ativo sem licença, e quem vincula licença é a RPC.
      // Por isso is_active entra por último e sempre false.
      expect(calls[0].sql).toContain('is_active');
      expect(calls[0].params[calls[0].params.length - 1]).toBe(false);
      expect(r.precisa_ativar).toBe(true);
    });

    it('edição NÃO grava is_active nem quando vem no corpo', async () => {
      const { svc, calls } = fakeTx([[{ app_mode: 'demo', totem_name: 'A' }], ATUALIZADO, []]);
      await svc.updateTotem(COMPANY, TOTEM, { totem_name: 'B', is_active: true }, USER);
      expect(acharUpdate(calls)!.sql).not.toContain('is_active');
    });

    it('a auditoria vai na MESMA transação do insert', async () => {
      const { svc, calls, db } = fakeTx([CRIADO, []]);
      await svc.createTotem(COMPANY, STORE, { totem_name: 'T' }, USER);
      expect((db as any).withTransaction).toHaveBeenCalled();
      expect(calls[1].sql).toContain('vw_devices_totem_config_audit');
      expect(calls[1].params[calls[1].params.length - 1]).toBe(USER);
    });

    it('edição de totem de outra empresa: 403 e NADA é escrito', async () => {
      const { svc, calls } = fakeTx([[]]);
      await expect(svc.updateTotem(COMPANY, TOTEM, { totem_name: 'X' }, USER)).rejects.toMatchObject(
        { status: 403 },
      );
      expect(acharUpdate(calls)).toBeUndefined();
    });

    it('o UPDATE carrega company_id, não só o id', async () => {
      const { svc, calls } = fakeTx([[{ app_mode: 'demo', totem_name: 'A' }], ATUALIZADO, []]);
      await svc.updateTotem(COMPANY, TOTEM, { totem_name: 'B' }, USER);
      expect(acharUpdate(calls)!.sql.replace(/\s+/g, ' ')).toContain(
        'where id = $1::uuid and company_id = $2::uuid',
      );
    });

    it('corpo sem nenhum campo útil não dispara UPDATE', async () => {
      const { svc, calls } = fakeTx([]);
      const r = await svc.updateTotem(COMPANY, TOTEM, {}, USER);
      expect(r.changed).toEqual([]);
      expect(calls).toHaveLength(0);
    });
  });

  describe('segredos TEF — a PRESENÇA da chave decide', () => {
    it('campo AUSENTE não entra no comando: mantém o que está gravado', async () => {
      const { svc, calls } = fakeTx([[{ app_mode: 'demo' }], ATUALIZADO, []]);
      await svc.updateTotem(COMPANY, TOTEM, { totem_name: 'B' }, USER);
      // Se entrasse como null, salvar o formulário apagaria a credencial TEF em produção —
      // a tela nunca recebe o segredo de volta para reenviar.
      expect(acharUpdate(calls)!.sql).not.toContain('aditum_partner_token_encrypted');
    });

    it('campo presente VAZIO limpa — de propósito, e só assim', async () => {
      const { svc, calls } = fakeTx([[{ app_mode: 'demo' }], ATUALIZADO, []]);
      await svc.updateTotem(COMPANY, TOTEM, { aditum_partner_token: '' }, USER);
      const up = acharUpdate(calls)!;
      expect(up.sql).toContain('aditum_partner_token_encrypted');
      expect(up.params.slice(2)).toEqual([null, null]);
    });

    it('campo com texto é CIFRADO, nunca gravado em claro', async () => {
      const { svc, calls } = fakeTx([[{ app_mode: 'demo' }], ATUALIZADO, []]);
      const segredo = 'token-guarana-1234';
      await svc.updateTotem(COMPANY, TOTEM, { aditum_partner_token: segredo }, USER);
      const up = acharUpdate(calls)!;
      expect(String(up.params[2]).startsWith('enc:v1:')).toBe(true);
      expect(String(up.params[2])).not.toContain(segredo);
      expect(up.params[3]).toBe('kid-de-teste');
    });

    it('o que foi cifrado volta idêntico — a cifra não grava lixo', async () => {
      const { svc, calls } = fakeTx([[{ app_mode: 'demo' }], ATUALIZADO, []]);
      // Com acento de propósito: o envelope é utf8, e um totem brasileiro vai ter acento.
      const segredo = 'ativação-çãó-99';
      await svc.updateTotem(COMPANY, TOTEM, { aditum_activation_code: segredo }, USER);
      const up = acharUpdate(calls)!;
      expect(
        decryptEnvelopeV1(String(up.params[2]), ENV_FAKE.SENSITIVE_SECRET_MASTER_KEY_BASE64),
      ).toBe(segredo);
    });

    it('dois segredos de uma vez saem com cifras diferentes', async () => {
      const { svc, calls } = fakeTx([[{ app_mode: 'demo' }], ATUALIZADO, []]);
      await svc.updateTotem(
        COMPANY,
        TOTEM,
        { aditum_partner_token: 'igual', aditum_activation_code: 'igual' },
        USER,
      );
      const up = acharUpdate(calls)!;
      // IV aleatório por chamada: texto igual não pode gerar cifra igual, senão dá para
      // deduzir que os dois segredos são o mesmo só olhando o banco.
      expect(up.params[2]).not.toBe(up.params[4]);
    });

    it('a auditoria registra QUE mudou, mas não guarda o segredo', async () => {
      const { svc, calls } = fakeTx([[{ app_mode: 'demo' }], ATUALIZADO, []]);
      await svc.updateTotem(COMPANY, TOTEM, { aditum_partner_token: 'segredo-guarana' }, USER);
      const aud = calls.find((c) => c.sql.includes('_audit'))!;
      const texto = JSON.stringify(aud.params);
      expect(texto).toContain('aditum_partner_token_encrypted');
      expect(texto).not.toContain('segredo-guarana');
      expect(texto).not.toContain('enc:v1:');
    });

    it('na criação o segredo também não vai em claro para a auditoria', async () => {
      const { svc, calls } = fakeTx([CRIADO, []]);
      await svc.createTotem(
        COMPANY,
        STORE,
        { totem_name: 'T', aditum_partner_token: 'segredo-guarana' },
        USER,
      );
      expect(calls[0].sql).toContain('aditum_partner_token_encrypted');
      expect(JSON.stringify(calls[1].params)).not.toContain('segredo-guarana');
    });
  });

  describe('a regra de licença julga o resultado FINAL', () => {
    it('mandar só nfce_environment=1 num totem demo é barrado', async () => {
      // O corpo não menciona `app_mode`; o que vale é como o totem FICA depois de salvar,
      // não o pedaço que veio na requisição.
      const { svc, calls } = fakeTx([[{ app_mode: 'demo', nfce_environment: 2 }], DEMO]);
      await expect(
        svc.updateTotem(COMPANY, TOTEM, { nfce_environment: 1 }, USER),
      ).rejects.toMatchObject({ status: 400 });
      expect(acharUpdate(calls)).toBeUndefined();
    });

    it('licença informada tem precedência sobre a vinculada', async () => {
      const { svc, calls } = fakeTx([[{ app_mode: 'demo' }], REAL, ATUALIZADO, []]);
      await svc.updateTotem(COMPANY, TOTEM, { app_mode: 'producao', license_id: LICENCA }, USER);
      expect(calls[1].sql).toContain('where id = $1::uuid');
      expect(calls[1].params[0]).toBe(LICENCA);
      expect(acharUpdate(calls)).toBeDefined();
    });

    it('sem licença informada, vale a que está vinculada ao totem', async () => {
      const { svc, calls } = fakeTx([[{ app_mode: 'demo' }], DEMO]);
      await expect(
        svc.updateTotem(COMPANY, TOTEM, { app_mode: 'producao' }, USER),
      ).rejects.toMatchObject({ status: 400 });
      expect(calls[1].sql).toContain('totem_config_id');
    });

    it('a API NUNCA escreve em billing — só lê a licença', async () => {
      const { svc, calls } = fakeTx([[{ app_mode: 'demo' }], REAL, ATUALIZADO, []]);
      await svc.updateTotem(COMPANY, TOTEM, { app_mode: 'producao', license_id: LICENCA }, USER);
      for (const c of calls) {
        if (/billing\./.test(c.sql)) expect(c.sql.trim().startsWith('select')).toBe(true);
      }
    });

    it('license_id NÃO vira coluna do totem — quem vincula é a RPC', async () => {
      const { svc, calls } = fakeTx([CRIADO, []]);
      await svc.createTotem(COMPANY, STORE, { totem_name: 'T', license_id: LICENCA }, USER);
      expect(calls[0].sql).not.toContain('license_id');
    });

    it('criar em produção com licença real passa', async () => {
      const { svc, calls } = fakeTx([REAL, CRIADO, []]);
      await svc.createTotem(
        COMPANY,
        STORE,
        { totem_name: 'T', app_mode: 'producao', license_id: LICENCA },
        USER,
      );
      expect(calls.some((c) => c.sql.includes('insert into public.vw_devices_totem_config'))).toBe(
        true,
      );
    });

    it('criar em produção com licença demo é barrado antes do insert', async () => {
      const { svc, calls } = fakeTx([DEMO]);
      await expect(
        svc.createTotem(
          COMPANY,
          STORE,
          { totem_name: 'T', app_mode: 'producao', license_id: LICENCA },
          USER,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(calls.some((c) => c.sql.includes('insert'))).toBe(false);
    });
  });
});
