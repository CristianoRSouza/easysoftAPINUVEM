import { describe, expect, it, vi } from 'vitest';
import { DevicesService } from '../src/modules/devices/application/devices.service';
import { AgentsRepository } from '../src/modules/devices/infrastructure/agents.repository';
import { DeviceAuditRepository } from '../src/modules/devices/infrastructure/device-audit.repository';
import { PixnopdvRepository } from '../src/modules/devices/infrastructure/pixnopdv.repository';
import { ProductImagesRepository } from '../src/modules/devices/infrastructure/product-images.repository';
import { TotemLicensesRepository } from '../src/modules/devices/infrastructure/totem-licenses.repository';
import { TotemsRepository } from '../src/modules/devices/infrastructure/totems.repository';
import { TOTEMS_SQL, TOTEM_SECRET_COLUMNS } from '../src/modules/devices/infrastructure/totems.sql';
import { PIXNOPDV_SQL, PIXNOPDV_SECRET_COLUMNS } from '../src/modules/devices/infrastructure/pixnopdv.sql';
import type { DbService } from '../src/db/db.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const STORE = '33333333-3333-4333-8333-333333333333';
const AGENT = '88888888-8888-4888-8888-888888888888';
const TOTEM = '99999999-9999-4999-8999-999999999999';

function fakeDb(rows: any[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows };
    }),
  } as unknown as DbService;
  const svc = new DevicesService(
    new TotemsRepository(db),
    new TotemLicensesRepository(db),
    new AgentsRepository(db),
    new DeviceAuditRepository(db),
    new PixnopdvRepository(db),
    new ProductImagesRepository(db),
  );
  return { db, calls, svc };
}

describe('DevicesService — agentes e auditoria, com a amarra que a RLS fazia', () => {
  describe('a amarra de empresa (o role da API tem BYPASSRLS)', () => {
    it('auditoria de agente confere o vínculo agente↔empresa', async () => {
      const { svc, calls } = fakeDb();
      await svc.agentAuditLogs(COMPANY, AGENT);
      // No browser esta consulta filtra SÓ por agent_config_id — quem barrava agente de
      // outra empresa era a RLS, que não vale aqui.
      expect(calls[0].sql).toContain('exists (select 1 from public.vw_nfce_service_agent a');
      expect(calls[0].sql).toContain('a.company_id = $2::uuid');
      expect(calls[0].params).toEqual([AGENT, COMPANY]);
    });

    it('auditoria de totem filtra por totem E empresa', async () => {
      const { svc, calls } = fakeDb();
      await svc.totemAuditLogs(COMPANY, TOTEM);
      expect(calls[0].sql).toContain('totem_config_id = $1::uuid and company_id = $2::uuid');
      expect(calls[0].params).toEqual([TOTEM, COMPANY]);
    });

    it('dispositivo de outra empresa devolve lista vazia, não erro', async () => {
      const { svc } = fakeDb([]);
      await expect(svc.agentAuditLogs(COMPANY, AGENT)).resolves.toEqual([]);
      await expect(svc.totemAuditLogs(COMPANY, TOTEM)).resolves.toEqual([]);
    });

    it('a auditoria unificada filtra as DUAS fontes pela empresa', async () => {
      const { svc, calls } = fakeDb();
      await svc.unifiedAuditLogs(COMPANY, 50);
      expect(calls[0].sql).toContain('ta.company_id = $1::uuid');
      expect(calls[0].sql).toContain('aa.company_id = $1::uuid');
    });
  });

  describe('agentes', () => {
    it('inclui os agentes GLOBAIS da empresa (store_id nulo) junto dos da loja', async () => {
      const { svc, calls } = fakeDb();
      await svc.agents(COMPANY, STORE);
      // Um serviço atendendo todas as lojas é config válida; filtrar só pela loja o sumiria.
      expect(calls[0].sql).toContain('store_id = $2::uuid or store_id is null');
      expect(calls[0].params).toEqual([COMPANY, STORE]);
    });

    it('sem loja escolhida, traz todos os agentes da empresa', async () => {
      const { svc, calls } = fakeDb();
      await svc.agents(COMPANY, null);
      expect(calls[0].params).toEqual([COMPANY, null]);
      expect(calls[0].sql).toContain('$2::uuid is null');
    });

    it('não faz select * — a lista de colunas é explícita', async () => {
      const { svc, calls } = fakeDb();
      await svc.agents(COMPANY, null);
      expect(calls[0].sql).not.toContain('select *');
      expect(calls[0].sql).toContain('agent_name');
    });
  });

  describe('auditoria unificada', () => {
    it('é UMA consulta — no browser eram quatro (2 de auditoria + 2 de nomes)', async () => {
      const { svc, calls } = fakeDb();
      await svc.unifiedAuditLogs(COMPANY, 50);
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toContain('union all');
      expect(calls[0].sql).toContain('left join');
    });

    it('nome cai no prefixo do id quando o dispositivo foi apagado', async () => {
      const { svc, calls } = fakeDb();
      await svc.unifiedAuditLogs(COMPANY, 50);
      // Apagar o totem não pode apagar o rastro de quem mexeu nele.
      expect(calls[0].sql).toContain('left(ta.totem_config_id::text, 8)');
      expect(calls[0].sql).toContain('left(aa.agent_config_id::text, 8)');
    });

    it('teto de 500 imposto pelo servidor; default 100', async () => {
      const { svc, calls } = fakeDb();
      await svc.unifiedAuditLogs(COMPANY, 999_999);
      expect(calls[0].params[1]).toBe(500);
      await svc.unifiedAuditLogs(COMPANY, 0);
      expect(calls[1].params[1]).toBe(100);
    });

    it('marca a origem de cada linha', async () => {
      const { svc } = fakeDb([
        { id: 'a1', source: 'agent', entity_id: AGENT, entity_name: 'Agente 1', action: 'updated' },
      ]);
      const [r] = await svc.unifiedAuditLogs(COMPANY, 50);
      expect(r.source).toBe('agent');
      expect(r.entity_name).toBe('Agente 1');
    });
  });

  describe('totens — os segredos NÃO saem do servidor (decisão B, 2026-07-30)', () => {
    it('nenhuma coluna de segredo aparece no SELECT', () => {
      for (const col of TOTEM_SECRET_COLUMNS) {
        // Só o valor cru é proibido; `<col>_set` e `<col>_kid` podem (e devem) aparecer.
        const cru = new RegExp(`t\\.${col}\\b(?!_set|_kid)(?![^\\n]*<>)`, 'g');
        const ocorrencias = [...TOTEMS_SQL.matchAll(cru)].filter(
          (m) => !TOTEMS_SQL.slice(m.index ?? 0, (m.index ?? 0) + 120).includes("<> ''"),
        );
        expect(ocorrencias, `coluna ${col} exposta crua no SELECT`).toHaveLength(0);
      }
    });

    it('e o SELECT não é `select *` — que traria os segredos de volta em silêncio', () => {
      expect(TOTEMS_SQL).not.toMatch(/select\s+\*/i);
      expect(TOTEMS_SQL).not.toMatch(/t\.\*/);
    });

    it('devolve o par _set em vez do valor', () => {
      for (const col of ['nfce_service_api_key', 'tef_http_api_key', 'pix_http_api_key']) {
        expect(TOTEMS_SQL).toContain(`as ${col}_set`);
      }
      expect(TOTEMS_SQL).toContain('as aditum_partner_token_set');
      expect(TOTEMS_SQL).toContain('as aditum_activation_code_set');
    });

    it('espaço em branco não conta como chave configurada', () => {
      expect(TOTEMS_SQL).toContain("btrim(t.nfce_service_api_key), '') <> ''");
    });

    it('os _kid continuam vindo — identificam a chave, não são segredo', () => {
      expect(TOTEMS_SQL).toContain('t.aditum_partner_token_kid');
      expect(TOTEMS_SQL).toContain('t.aditum_activation_code_kid');
    });

    it('a resposta montada não carrega nenhum campo de segredo', async () => {
      const { svc } = fakeDb([
        {
          id: TOTEM,
          totem_name: 'TOTEM-01',
          nfce_service_api_key_set: true,
          tef_http_api_key_set: false,
          license_type: 'monthly',
        },
      ]);
      const [t] = await svc.totems(COMPANY, null);
      for (const col of TOTEM_SECRET_COLUMNS) expect(t).not.toHaveProperty(col);
      expect(t.nfce_service_api_key_set).toBe(true);
    });
  });

  describe('totens — licença', () => {
    it('a licença REAL ganha da demo quando o totem tem as duas', async () => {
      const { svc, calls } = fakeDb();
      await svc.totems(COMPANY, null);
      // Sem esta ordenação, um totem pago apareceria como demo pela ordem das linhas.
      expect(calls[0].sql).toContain("'ecp-demo' then 1");
      expect(calls[0].sql).toContain('limit 1');
    });

    it('tipo genérico não vira nome de plano', async () => {
      const { svc } = fakeDb([{ id: TOTEM, license_type: 'monthly' }]);
      const [t] = await svc.totems(COMPANY, null);
      expect(t.plan_name).toBeNull();
    });

    it('tipo específico vira nome de plano', async () => {
      const { svc } = fakeDb([{ id: TOTEM, license_type: 'Plano Enterprise' }]);
      const [t] = await svc.totems(COMPANY, null);
      expect(t.plan_name).toBe('Plano Enterprise');
    });

    it('licença disponível = ativa E sem totem vinculado', async () => {
      const { svc, calls } = fakeDb();
      await svc.availableTotemLicenses(COMPANY, null);
      expect(calls[0].sql).toContain("status = 'active'");
      expect(calls[0].sql).toContain('totem_config_id is null');
      // sem totem em edição, o terceiro parâmetro é nulo e a condição extra não pega nada
      expect(calls[0].params).toEqual([COMPANY, null, null]);
    });

    it('na EDIÇÃO, a licença já vinculada ao totem também entra na lista', async () => {
      // Sem isto a aba Licença abre vazia num totem já licenciado — a empresa costuma ter
      // uma licença por totem, então "só as livres" devolve nada. E é pior que uma lista
      // vazia: o diálogo procura a licença atual NESTA lista, não acha, e cai num objeto
      // sintético que mostra o NOME DO TOTEM onde deveria estar o código da licença.
      const { svc, calls } = fakeDb();
      await svc.availableTotemLicenses(COMPANY, STORE, TOTEM);
      expect(calls[0].sql).toContain('totem_config_id = $3::uuid');
      expect(calls[0].params).toEqual([COMPANY, STORE, TOTEM]);
    });

    it('as três rotas de totem filtram pela empresa', async () => {
      const { svc, calls } = fakeDb();
      await svc.totems(COMPANY, STORE);
      await svc.totemLicenses(COMPANY, STORE);
      await svc.availableTotemLicenses(COMPANY, STORE);
      for (const c of calls) {
        expect(c.sql).toContain('company_id = $1::uuid');
        // a de licenças oferecíveis leva um terceiro parâmetro (o totem em edição)
        expect(c.params.slice(0, 2)).toEqual([COMPANY, STORE]);
      }
    });

    it('a API só LÊ billing.device_licenses — nunca escreve (fronteira §10)', async () => {
      const { svc, calls } = fakeDb();
      await svc.totems(COMPANY, null);
      await svc.totemLicenses(COMPANY, null);
      for (const c of calls) {
        expect(c.sql).toContain('billing.device_licenses');
        expect(c.sql).not.toMatch(/insert\s+into\s+billing\.|update\s+billing\.|delete\s+from\s+billing\./i);
      }
    });
  });

  describe('PIXnoPDV e imagens — segredos e amarra de loja', () => {
    it('o SELECT do PIX nao traz basic_token nem secret_key', () => {
      for (const col of PIXNOPDV_SECRET_COLUMNS) {
        // A coluna crua não pode estar numa linha que a devolva. Ela SÓ pode aparecer
        // dentro do `coalesce(btrim(...)) <> ''` que produz o booleano `_set`.
        const expostas = PIXNOPDV_SQL.split('\n').filter(
          (l) => l.includes(col) && !l.includes('_set'),
        );
        expect(expostas, `${col} exposto cru`).toEqual([]);
      }
      expect(PIXNOPDV_SQL).not.toMatch(/select\s+\*/i);
    });

    it('devolve os pares _set em vez dos valores', async () => {
      const { svc } = fakeDb([{ store_id: STORE, environment: 'producao', basic_token_set: true, secret_key_set: false, enabled: true }]);
      const r = (await svc.pixnopdvCredentials(COMPANY, STORE))!;
      expect(r.basic_token_set).toBe(true);
      expect(r.secret_key_set).toBe(false);
      for (const col of PIXNOPDV_SECRET_COLUMNS) expect(r).not.toHaveProperty(col);
    });

    it('sem credencial cadastrada devolve null — situacao normal, nao erro', async () => {
      const { svc } = fakeDb([]);
      await expect(svc.pixnopdvCredentials(COMPANY, STORE)).resolves.toBeNull();
    });

    it('PIX filtra empresa, loja e ambiente de producao', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.pixnopdvCredentials(COMPANY, STORE);
      expect(calls[0].sql).toContain('company_id = $1::uuid');
      expect(calls[0].sql).toContain('store_id = $2::uuid');
      expect(calls[0].sql).toContain("environment = 'producao'");
      expect(calls[0].params).toEqual([COMPANY, STORE]);
    });

    it('imagens: a loja entra no WHERE junto dos ids', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.productImages(STORE, ['a', 'b']);
      // Sem a loja, uma lista de ids de outra loja devolveria as imagens dela.
      expect(calls[0].sql).toContain('store_id = $1::uuid');
      expect(calls[0].params).toEqual([STORE, ['a', 'b']]);
    });

    it('imagens: lista vazia nao vai ao banco', async () => {
      const { svc, calls } = fakeDb([]);
      await expect(svc.productImages(STORE, [])).resolves.toEqual({});
      expect(calls).toHaveLength(0);
    });

    it('imagens: devolve mapa id -> url', async () => {
      const { svc } = fakeDb([{ id: 'p1', image_url: 'https://x/1.png' }]);
      await expect(svc.productImages(STORE, ['p1'])).resolves.toEqual({ p1: 'https://x/1.png' });
    });
  });

  describe('forma da auditoria', () => {
    it('campos estruturados nulos viram lista/objeto vazio, não null', async () => {
      const { svc } = fakeDb([
        {
          id: 'x1',
          agent_config_id: AGENT,
          action: 'updated',
          changed_fields: null,
          previous_values: null,
          new_values: null,
          performed_by: null,
          created_at: new Date('2026-07-30T12:00:00.000Z'),
        },
      ]);
      const [r] = await svc.agentAuditLogs(COMPANY, AGENT);
      // A tela itera sobre eles; null viraria "não foi possível carregar".
      expect(r.changed_fields).toEqual([]);
      expect(r.previous_values).toEqual({});
      expect(r.new_values).toEqual({});
      expect(r.performed_by).toBe('admin');
      expect(r.created_at).toBe('2026-07-30T12:00:00.000Z');
    });

    it('valores presentes são preservados', async () => {
      const { svc } = fakeDb([
        {
          id: 'x1',
          agent_config_id: AGENT,
          action: 'updated',
          changed_fields: ['log_level'],
          previous_values: { log_level: 'info' },
          new_values: { log_level: 'debug' },
          performed_by: 'joao@exemplo.com',
        },
      ]);
      const [r] = await svc.agentAuditLogs(COMPANY, AGENT);
      expect(r.changed_fields).toEqual(['log_level']);
      expect(r.new_values).toEqual({ log_level: 'debug' });
      expect(r.performed_by).toBe('joao@exemplo.com');
    });

    it('um array em previous_values não é aceito como objeto', async () => {
      const { svc } = fakeDb([{ id: 'x1', agent_config_id: AGENT, previous_values: [1, 2] }]);
      const [r] = await svc.agentAuditLogs(COMPANY, AGENT);
      expect(r.previous_values).toEqual({});
    });
  });
});
