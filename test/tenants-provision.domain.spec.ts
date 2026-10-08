import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import {
  apiKeyFingerprint,
  generateApiKey,
  generatePassword,
  sha256hex,
} from '../src/modules/tenants/domain/credentials';
import {
  apiKeyName,
  formatCnpj,
  newStoreNames,
  resolutionOfExisting,
  revealOneTimeSecrets,
  toCompanyData,
  type ProvisionedStore,
} from '../src/modules/tenants/domain/provision';

/** As regras puras do provisionamento — sem Auth, sem banco. */

const ID = '11111111-1111-4111-8111-111111111111';
const OUTRO = '22222222-2222-4222-8222-222222222222';

const loja = (over: Partial<ProvisionedStore> = {}): ProvisionedStore => ({
  store_id: OUTRO,
  legacy_store_code: 1,
  cnpj: null,
  is_new: true,
  id_resolution: 'newly_created',
  api_key_status: 'created',
  api_key_id: 'k1',
  users: [],
  ...over,
});

describe('formatCnpj', () => {
  it('14 dígitos viram 00.000.000/0000-00, venham com ou sem máscara', () => {
    expect(formatCnpj('12345678000199')).toBe('12.345.678/0001-99');
    expect(formatCnpj('12.345.678/0001-99')).toBe('12.345.678/0001-99');
  });

  it('quantidade diferente de 14 dígitos passa como veio', () => {
    expect(formatCnpj('123')).toBe('123');
    expect(formatCnpj('123456780001999')).toBe('123456780001999');
  });
});

describe('toCompanyData', () => {
  it('ausência vira null e o CNPJ sai formatado', () => {
    expect(toCompanyData({ cnpj: '12345678000199', name: 'Empresa' })).toEqual({
      company_id: null,
      cnpj: '12.345.678/0001-99',
      name: 'Empresa',
      document: null,
      email: null,
      phone: null,
      address: null,
      city: null,
      state: null,
    });
  });

  it('CNPJ vazio é ausência', () => {
    expect(toCompanyData({ company_id: ID, cnpj: '' }).cnpj).toBeNull();
  });
});

describe('resolutionOfExisting', () => {
  it('achou o MESMO id que o cliente mandou: client_provided_match', () => {
    expect(resolutionOfExisting(ID, ID)).toBe('client_provided_match');
  });

  it('cliente não mandou id: matched_by_cnpj', () => {
    expect(resolutionOfExisting(null, ID)).toBe('matched_by_cnpj');
    expect(resolutionOfExisting(undefined, ID)).toBe('matched_by_cnpj');
  });

  it('cliente mandou um id, mas o registro achado (pelo CNPJ) é outro: matched_by_cnpj', () => {
    expect(resolutionOfExisting(OUTRO, ID)).toBe('matched_by_cnpj');
  });
});

describe('nomes da loja nova e da chave', () => {
  it('um nome cobre a falta do outro', () => {
    expect(newStoreNames({ trade_name: 'Fantasia' })).toEqual({ legalName: 'Fantasia', tradeName: 'Fantasia' });
    expect(newStoreNames({ legal_name: 'Razão' })).toEqual({ legalName: 'Razão', tradeName: 'Razão' });
  });

  it('com os dois, cada um fica no seu lugar', () => {
    expect(newStoreNames({ legal_name: 'Razão', trade_name: 'Fantasia' })).toEqual({
      legalName: 'Razão',
      tradeName: 'Fantasia',
    });
  });

  it('sem nenhum (ou em branco): "Loja"', () => {
    expect(newStoreNames({})).toEqual({ legalName: 'Loja', tradeName: 'Loja' });
    expect(newStoreNames({ legal_name: '', trade_name: '' })).toEqual({ legalName: 'Loja', tradeName: 'Loja' });
  });

  it('a chave leva o nome fantasia, depois a razão social, depois "Loja"', () => {
    expect(apiKeyName({ trade_name: 'Fantasia', legal_name: 'Razão' })).toBe('API Key - Fantasia');
    expect(apiKeyName({ legal_name: 'Razão' })).toBe('API Key - Razão');
    expect(apiKeyName({})).toBe('API Key - Loja');
  });
});

describe('revealOneTimeSecrets', () => {
  it('chave criada agora aparece em texto; a que já existia vem null', () => {
    const out = revealOneTimeSecrets(
      [loja({ api_key_status: 'created' }), loja({ api_key_status: 'existente' })],
      ['sk_live_a', 'sk_live_b'],
      new Map(),
    );
    expect(out[0].api_key).toBe('sk_live_a');
    expect(out[1].api_key).toBeNull();
  });

  it('a chave é casada pelo ÍNDICE da loja', () => {
    const out = revealOneTimeSecrets([loja(), loja()], ['sk_live_a', 'sk_live_b'], new Map());
    expect(out.map((s) => s.api_key)).toEqual(['sk_live_a', 'sk_live_b']);
  });

  it('senha temporária só para quem foi criado agora — casando o e-mail sem diferenciar caixa', () => {
    const out = revealOneTimeSecrets(
      [
        loja({
          users: [
            { user_id: 'u1', email: 'Novo@EasySoft.com.br' },
            { user_id: 'u2', email: 'antigo@easysoft.com.br' },
          ],
        }),
      ],
      ['sk_live_a'],
      new Map([['novo@easysoft.com.br', 'Senha-Temp-1']]),
    );
    expect(out[0].users[0]).toEqual({
      user_id: 'u1',
      email: 'Novo@EasySoft.com.br',
      is_new: true,
      temporary_password: 'Senha-Temp-1',
    });
    expect(out[0].users[1]).toEqual({ user_id: 'u2', email: 'antigo@easysoft.com.br', is_new: false });
    expect(out[0].users[1]).not.toHaveProperty('temporary_password');
  });

  it('preserva a ordem das chaves da resposta (segredo entra no fim; users fica onde estava)', () => {
    const [s] = revealOneTimeSecrets([loja()], ['sk_live_a'], new Map());
    expect(Object.keys(s)).toEqual([
      'store_id',
      'legacy_store_code',
      'cnpj',
      'is_new',
      'id_resolution',
      'api_key_status',
      'api_key_id',
      'users',
      'api_key',
    ]);
  });
});

describe('credenciais geradas', () => {
  it('API key: prefixo sk_live_ + 32 caracteres alfanuméricos', () => {
    expect(generateApiKey()).toMatch(/^sk_live_[A-Za-z0-9]{32}$/);
  });

  it('duas chaves seguidas não se repetem', () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });

  it('senha temporária: 16 caracteres do alfabeto alfanumérico + !@#$%', () => {
    expect(generatePassword()).toMatch(/^[A-Za-z0-9!@#$%]{16}$/);
  });

  it('o banco recebe o sha256 em hex e os 8 primeiros caracteres', () => {
    const key = 'sk_live_ABCDEFGH';
    expect(sha256hex(key)).toBe(crypto.createHash('sha256').update(key).digest('hex'));
    expect(apiKeyFingerprint(key)).toEqual({ apiKeyHash: sha256hex(key), apiKeyPrefix: 'sk_live_' });
  });
});
