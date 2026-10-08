import { describe, expect, it, vi } from 'vitest';
import { diffDeAuditoria } from '../src/modules/devices/domain/audit-diff';
import {
  MAX_AUDIT,
  limiteDeAuditoria,
  mapAudit,
  mapUnifiedAudit,
} from '../src/modules/devices/domain/device-audit.mapper';
import {
  mapPixnopdvCredentials,
  mapProductImages,
  mapTotem,
  normalizeRow,
} from '../src/modules/devices/domain/devices.mapper';
import {
  credenciaisPixnopdvSemSegredos,
  mesclarCredenciaisPixnopdv,
  type PixnopdvGravado,
} from '../src/modules/devices/domain/pixnopdv-credentials';
import { recusaConhecidaDaRpcDeTotem } from '../src/modules/devices/domain/totem-rpc-refusals';
import {
  colunasCifradas,
  segredosTefParaGravar,
  semSegredos,
} from '../src/modules/devices/domain/totem-tef-secrets.rule';
import {
  ambientesDepoisDeSalvar,
  camposDeCriacao,
  camposDeEdicao,
} from '../src/modules/devices/domain/totem-write.mapper';

/**
 * As regras PURAS de dispositivos — as que não precisam de banco nem de Nest para serem
 * provadas. Os testes de service continuam cobrindo o caminho inteiro; estes fixam o
 * comportamento de cada peça isolada.
 */
describe('devices/domain — regras puras', () => {
  describe('diff da auditoria de edição', () => {
    it('registra só o que mudou, com o de/para', () => {
      const r = diffDeAuditoria(
        ['log_level', 'sefaz_timeout_ms'],
        { log_level: 'info', sefaz_timeout_ms: 5000 },
        { log_level: 'debug', sefaz_timeout_ms: 5000 },
      );
      expect(r).toEqual({
        mudou: ['log_level'],
        de: { log_level: 'info' },
        para: { log_level: 'debug' },
      });
    });

    it('ausência dos dois lados é igual: undefined e null não contam como mudança', () => {
      const r = diffDeAuditoria(['install_path'], { install_path: null }, {});
      expect(r.mudou).toEqual([]);
    });

    it('compara lista por conteúdo, não por referência', () => {
      const r = diffDeAuditoria(['x'], { x: ['a', 'b'] }, { x: ['a', 'b'] });
      expect(r.mudou).toEqual([]);
    });

    it('valor que some vira null no "para"', () => {
      const r = diffDeAuditoria(['x'], { x: 1 }, { x: undefined });
      expect(r).toEqual({ mudou: ['x'], de: { x: 1 }, para: { x: null } });
    });
  });

  describe('teto da auditoria unificada', () => {
    it('pedido válido passa; acima do teto é cortado', () => {
      expect(limiteDeAuditoria(50)).toBe(50);
      expect(limiteDeAuditoria(999_999)).toBe(MAX_AUDIT);
    });

    it('zero e negativo caem no default de 100', () => {
      expect(limiteDeAuditoria(0)).toBe(100);
      expect(limiteDeAuditoria(-5)).toBe(100);
    });
  });

  describe('linha de auditoria', () => {
    it('campos estruturados nulos viram vazios, e quem alterou cai em "admin"', () => {
      const r = mapAudit({ id: 1, action: null, created_at: null });
      expect(r).toEqual({
        id: '1',
        action: '',
        changed_fields: [],
        previous_values: {},
        new_values: {},
        performed_by: 'admin',
        created_at: '',
      });
    });

    it('só carrega o id do dono que veio na linha', () => {
      expect(mapAudit({ id: 1, agent_config_id: 'a' })).toHaveProperty('agent_config_id', 'a');
      expect(mapAudit({ id: 1, agent_config_id: 'a' })).not.toHaveProperty('totem_config_id');
    });

    it('unificada: nome ausente vira string vazia', () => {
      const r = mapUnifiedAudit({ id: 1, source: 'totem', entity_id: 't1', entity_name: null });
      expect(r).toMatchObject({ source: 'totem', entity_id: 't1', entity_name: '' });
    });
  });

  describe('linhas de leitura', () => {
    it('normalizeRow: só data vira ISO, o resto passa como veio', () => {
      const d = new Date('2026-07-30T12:00:00.000Z');
      expect(normalizeRow({ a: d, b: 1, c: null })).toEqual({
        a: '2026-07-30T12:00:00.000Z',
        b: 1,
        c: null,
      });
    });

    it('mapTotem: plan_name só existe quando o tipo não é genérico', () => {
      expect(mapTotem({ license_type: 'Plano Pro' }).plan_name).toBe('Plano Pro');
      expect(mapTotem({ license_type: 'MONTHLY' }).plan_name).toBeNull();
      expect(mapTotem({ license_type: null }).plan_name).toBeNull();
    });

    it('mapPixnopdvCredentials: `_set` só é verdadeiro com true de verdade', () => {
      const r = mapPixnopdvCredentials({
        store_id: 's',
        basic_token_set: 't',
        secret_key_set: true,
        updated_at: null,
      });
      expect(r).toMatchObject({
        environment: 'producao',
        basic_token_set: false,
        secret_key_set: true,
        updated_at: null,
      });
    });

    it('mapProductImages: lista vira mapa id → url', () => {
      expect(mapProductImages([{ id: 'p1', image_url: 'u1' }])).toEqual({ p1: 'u1' });
    });
  });

  describe('PIXnoPDV — a presença da chave decide', () => {
    const GRAVADO: PixnopdvGravado = {
      api_base_url: 'https://antigo',
      basic_user: 'user',
      basic_token: 'TOKEN',
      secret_key: 'SEGREDO',
      insecure_tls: true,
      enabled: false,
    };

    it('campo ausente mantém o gravado', () => {
      expect(mesclarCredenciaisPixnopdv({}, GRAVADO)).toEqual(GRAVADO);
    });

    it('campo presente com vazio apaga; a URL perde a barra final', () => {
      const r = mesclarCredenciaisPixnopdv(
        { basic_token: '  ', api_base_url: 'https://novo/api//' },
        GRAVADO,
      );
      expect(r.basic_token).toBeNull();
      expect(r.api_base_url).toBe('https://novo/api');
      expect(r.secret_key).toBe('SEGREDO');
    });

    it('sem nada gravado: nasce habilitado e sem TLS inseguro', () => {
      expect(mesclarCredenciaisPixnopdv({}, null)).toMatchObject({
        enabled: true,
        insecure_tls: false,
        basic_token: null,
      });
    });

    it('a resposta nunca carrega os segredos', () => {
      const r = credenciaisPixnopdvSemSegredos('loja', mesclarCredenciaisPixnopdv({}, GRAVADO));
      expect(r).not.toHaveProperty('basic_token');
      expect(r).not.toHaveProperty('secret_key');
      expect(r).toMatchObject({ store_id: 'loja', basic_token_set: true, secret_key_set: true });
    });
  });

  describe('recusas da RPC de totem', () => {
    it('reconhece a mensagem com espaço em volta', () => {
      expect(recusaConhecidaDaRpcDeTotem(new Error(' totem_not_found '))).toMatchObject({
        tipo: 'nao_encontrado',
        error: 'totem_not_found',
      });
    });

    it('o que não é recusa conhecida devolve null — inclusive o que não é Error', () => {
      expect(recusaConhecidaDaRpcDeTotem(new Error('connection reset'))).toBeNull();
      expect(recusaConhecidaDaRpcDeTotem('totem_not_found')).toBeNull();
      expect(recusaConhecidaDaRpcDeTotem(new Error('constructor'))).toBeNull();
    });
  });

  describe('segredos TEF — a presença da chave decide', () => {
    const cifrar = (texto: string) => ({ cifrado: `enc(${texto})`, kid: 'k1' });

    it('chave ausente não entra no comando, e a cifra nem é chamada', () => {
      const espia = vi.fn(cifrar);
      expect(segredosTefParaGravar({ totem_name: 'T' }, espia)).toEqual({ campos: [], valores: [] });
      expect(espia).not.toHaveBeenCalled();
    });

    it('chave presente vazia limpa o par cifrado/kid sem cifrar', () => {
      const espia = vi.fn(cifrar);
      const r = segredosTefParaGravar({ aditum_partner_token: '' }, espia);
      expect(r).toEqual({
        campos: ['aditum_partner_token_encrypted', 'aditum_partner_token_kid'],
        valores: [null, null],
      });
      expect(espia).not.toHaveBeenCalled();
    });

    it('chave presente com texto cifra o texto aparado', () => {
      const r = segredosTefParaGravar({ aditum_activation_code: '  abc ' }, cifrar);
      expect(r).toEqual({
        campos: ['aditum_activation_code_encrypted', 'aditum_activation_code_kid'],
        valores: ['enc(abc)', 'k1'],
      });
      expect(colunasCifradas(r)).toEqual(['aditum_activation_code_encrypted']);
    });

    it('semSegredos mascara o que veio e não inventa o que não veio', () => {
      expect(semSegredos({ totem_name: 'T', aditum_partner_token: 'x' })).toEqual({
        totem_name: 'T',
        aditum_partner_token: '***',
      });
    });
  });

  describe('campos e ambientes do totem', () => {
    it('criação sempre leva o nome; is_active nunca entra', () => {
      const campos = camposDeCriacao({ totem_name: 'T', is_active: true, app_mode: 'demo' });
      expect(campos[0]).toBe('totem_name');
      expect(campos).toContain('app_mode');
      expect(campos).not.toContain('is_active');
    });

    it('edição só leva o que veio no corpo', () => {
      expect(camposDeEdicao({})).toEqual([]);
      expect(camposDeEdicao({ totem_name: 'B' })).toEqual(['totem_name']);
    });

    it('o ambiente final é o do corpo quando veio, e o gravado quando não', () => {
      const final = ambientesDepoisDeSalvar(
        { nfce_environment: 1 },
        { app_mode: 'demo', payment_environment: 'homologacao', nfce_environment: 2 },
      );
      expect(final).toEqual({
        app_mode: 'demo',
        payment_environment: 'homologacao',
        nfce_environment: 1,
      });
    });
  });
});
