import { describe, expect, it, vi } from 'vitest';
import { AgentWriteService } from '../src/modules/devices/application/agent-write.service';
import { PixnopdvWriteService } from '../src/modules/devices/application/pixnopdv-write.service';
import { TotemActivationService } from '../src/modules/devices/application/totem-activation.service';
import { recusaDaRpcDeTotem } from '../src/modules/devices/application/totem-rpc-refusal.mapper';
import { AgentsRepository } from '../src/modules/devices/infrastructure/agents.repository';
import { PixnopdvRepository } from '../src/modules/devices/infrastructure/pixnopdv.repository';
import { TotemLicensesRepository } from '../src/modules/devices/infrastructure/totem-licenses.repository';
import { TotemsRepository } from '../src/modules/devices/infrastructure/totems.repository';
import type { DbService } from '../src/db/db.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const STORE = '33333333-3333-4333-8333-333333333333';
const TOTEM = '99999999-9999-4999-8999-999999999999';
const AGENT = '88888888-8888-4888-8888-888888888888';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Chave de 32 bytes só para o teste — não é, e nunca foi, chave de nenhum ambiente. */
export const ENV_FAKE = {
  SENSITIVE_SECRET_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
  SENSITIVE_SECRET_KEY_ID: 'kid-de-teste',
} as any;

/**
 * As escritas de dispositivos, montadas sobre o MESMO `db` falso. A classe única de antes
 * virou um caso de uso por agregado; aqui eles voltam a ter uma cara só, para os testes
 * continuarem falando `svc.setTotemActive(...)`, `svc.savePixnopdv(...)` etc.
 */
function montarEscritas(db: DbService) {
  const ativacao = new TotemActivationService(
    new TotemsRepository(db),
    new TotemLicensesRepository(db),
  );
  const agentes = new AgentWriteService(new AgentsRepository(db));
  const pixnopdv = new PixnopdvWriteService(new PixnopdvRepository(db));
  return {
    setTotemActive: ativacao.setTotemActive.bind(ativacao),
    requeueTotemSync: ativacao.requeueTotemSync.bind(ativacao),
    createAgent: agentes.createAgent.bind(agentes),
    updateAgent: agentes.updateAgent.bind(agentes),
    setAgentActive: agentes.setAgentActive.bind(agentes),
    savePixnopdv: pixnopdv.savePixnopdv.bind(pixnopdv),
  };
}

/** `respostas` é consumida em ordem; cada elemento é o `rows` da chamada correspondente. */
function fakeDb(respostas: any[][] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params: params ?? [] });
    return { rows: respostas[i++] ?? [] };
  });
  const rlsClaims: any[] = [];
  const db = {
    query,
    // withClaims existe porque as RPCs de totem autorizam por auth.uid(); o fake guarda os
    // claims para o teste poder afirmar QUEM a RPC vai enxergar.
    withClaims: vi.fn(async (claims: any, fn: any) => {
      rlsClaims.push(claims);
      return fn({ query });
    }),
  } as unknown as DbService;
  return { db, calls, rlsClaims, svc: montarEscritas(db) };
}

const PERTENCE = [{ ok: true }];
const NAO_PERTENCE = [{ ok: false }];

describe('DevicesWriteService — escrita não pode atravessar empresas', () => {
  describe('a amarra vem ANTES da escrita', () => {
    it('totem de outra empresa: 403 e a RPC NÃO é chamada', async () => {
      const { svc, calls } = fakeDb([NAO_PERTENCE]);
      await expect(
        svc.setTotemActive(COMPANY, TOTEM, { is_active: false }, USER),
      ).rejects.toMatchObject({ status: 403 });
      // O ponto: parou na checagem. Se a RPC tivesse rodado, o totem alheio estaria
      // desativado — e a RPC recebe só o id, sem recorte de tenant.
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toContain('vw_devices_totem_config');
      expect(calls[0].params).toEqual([TOTEM, COMPANY]);
    });

    it('requeue de totem alheio: 403 e a RPC NÃO é chamada', async () => {
      const { svc, calls } = fakeDb([NAO_PERTENCE]);
      await expect(svc.requeueTotemSync(COMPANY, TOTEM, USER)).rejects.toMatchObject({
        status: 403,
      });
      expect(calls).toHaveLength(1);
    });

    it('totem da empresa: checa e então chama a RPC', async () => {
      const { svc, calls } = fakeDb([PERTENCE, [{ app_mode: 'demo' }], [{ ok: true }]]);
      await svc.setTotemActive(COMPANY, TOTEM, { is_active: true }, USER);
      const rpc = calls.find((c) => c.sql.includes('cloud_set_totem_active'));
      expect(rpc).toBeDefined();
      expect(rpc!.params[0]).toBe(TOTEM);
    });
  });

  /**
   * O bug que este bloco tranca: as RPCs de totem são `SECURITY DEFINER` e autorizam por
   * `auth.uid()`. Chamadas pela conexão comum da API, `auth.uid()` é NULO e elas negam
   * tudo — a rota "funciona" no typecheck e morre no primeiro clique real.
   */
  describe('as RPCs de totem precisam saber QUEM está chamando', () => {
    it('ativação roda por withClaims, com o usuário da sessão nos claims', async () => {
      const { svc, rlsClaims } = fakeDb([PERTENCE, [{ app_mode: 'demo' }], [{ ok: true }]]);
      await svc.setTotemActive(COMPANY, TOTEM, { is_active: true }, USER);
      expect(rlsClaims).toHaveLength(1);
      expect(rlsClaims[0]).toMatchObject({ sub: USER, role: 'authenticated' });
    });

    it('requeue também — mesma RPC, mesma exigência', async () => {
      const { svc, rlsClaims } = fakeDb([PERTENCE, [{ ok: true }]]);
      await svc.requeueTotemSync(COMPANY, TOTEM, USER);
      expect(rlsClaims[0]).toMatchObject({ sub: USER });
    });

    /**
     * As duas RPCs retornam `jsonb`. Em `select * from f()` isso vira UMA coluna com o
     * nome da função, e a resposta sairia como `{ cloud_set_totem_active: {...} }` — a
     * tela leria `undefined` em todo campo. O alias `as resultado` desembrulha.
     */
    it('a resposta da RPC sai desembrulhada, não dentro do nome da função', async () => {
      const dentro = { totem_id: TOTEM, is_active: true, license_id: null };
      // [] na busca da licença vinculada: nenhuma — o teste aqui é só o desembrulho.
      const { svc } = fakeDb([PERTENCE, [], [{ app_mode: 'demo' }], [{ resultado: dentro }]]);
      const r = await svc.setTotemActive(COMPANY, TOTEM, { is_active: true }, USER);
      expect(r).toEqual(dentro);
    });
  });

  /**
   * "Novo Totem" criava o totem e dava "Erro interno" (30/09/2026): o gatilho
   * `ensure_demo_license_for_totem` vincula uma demo no INSERT, a tela ativa com
   * `license_id: null`, e a RPC recusava com `license_required_for_active_totem` → 500.
   */
  describe('ativar sem licença informada usa a já vinculada ao totem', () => {
    const LIC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    it('sem license_id: busca a licença ativa do totem e a passa à RPC', async () => {
      const { svc, calls } = fakeDb([
        PERTENCE,
        [{ id: LIC }],
        [{ app_mode: 'demo' }],
        [{ license_type: 'demo', plan_slug: 'ecp-demo' }],
        [{ resultado: { totem_id: TOTEM, is_active: true, license_id: LIC } }],
      ]);
      await svc.setTotemActive(COMPANY, TOTEM, { is_active: true, license_id: null }, USER);
      const busca = calls.find((c) => c.sql.includes('billing.device_licenses') && c.sql.includes("status = 'active'"));
      expect(busca?.params).toEqual([TOTEM]);
      const rpc = calls.find((c) => c.sql.includes('cloud_set_totem_active'));
      expect(rpc?.params).toEqual([TOTEM, true, LIC]);
    });

    it('licença informada vence: não busca a vinculada', async () => {
      const OUTRA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const { svc, calls } = fakeDb([
        PERTENCE,
        [{ app_mode: 'demo' }],
        [{ license_type: 'demo', plan_slug: 'ecp-demo' }],
        [{ resultado: { ok: true } }],
      ]);
      await svc.setTotemActive(COMPANY, TOTEM, { is_active: true, license_id: OUTRA }, USER);
      expect(calls.some((c) => c.sql.includes("status = 'active'"))).toBe(false);
      expect(calls.find((c) => c.sql.includes('cloud_set_totem_active'))?.params).toEqual([TOTEM, true, OUTRA]);
    });

    it('desativar não procura licença', async () => {
      const { svc, calls } = fakeDb([PERTENCE, [{ resultado: { ok: true } }]]);
      await svc.setTotemActive(COMPANY, TOTEM, { is_active: false }, USER);
      expect(calls.some((c) => c.sql.includes("status = 'active'"))).toBe(false);
    });
  });

  describe('recusa da RPC vira erro de negócio, não 500', () => {
    it('license_required_for_active_totem → 400 com mensagem que diz o que fazer', async () => {
      const respostas: unknown[][] = [PERTENCE, [], [{ app_mode: 'demo' }]];
      let i = 0;
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('cloud_set_totem_active')) throw new Error('license_required_for_active_totem');
        return { rows: respostas[i++] ?? [] };
      });
      const db = {
        query,
        withClaims: vi.fn(async (_c: unknown, fn: (c: unknown) => unknown) => fn({ query })),
      } as unknown as DbService;
      const svc = montarEscritas(db);
      await expect(svc.setTotemActive(COMPANY, TOTEM, { is_active: true }, USER)).rejects.toMatchObject({
        status: 400,
        response: { error: 'license_required' },
      });
    });

    it('erro desconhecido continua subindo como está (500)', () => {
      expect(recusaDaRpcDeTotem(new Error('connection reset'))).toBeNull();
      expect(recusaDaRpcDeTotem(new Error('totem_access_denied'))?.getStatus()).toBe(403);
    });

    it('o requeue devolve o jsonb da RPC, não a coluna que o embrulha', async () => {
      const dentro = { licenses_requeued: 3 };
      const { svc, calls } = fakeDb([PERTENCE, [{ resultado: dentro }]]);
      const r = await svc.requeueTotemSync(COMPANY, TOTEM, USER);
      expect(r).toEqual(dentro);
      // `select *` traria a coluna embrulhada de volta — o alias é o que evita isso.
      expect(calls[1].sql).toContain('as resultado');
      expect(calls[1].sql).not.toContain('select * from');
    });

    it('a checagem de empresa da API continua ANTES — não delega à RPC', async () => {
      const { svc, rlsClaims } = fakeDb([NAO_PERTENCE]);
      await expect(svc.requeueTotemSync(COMPANY, TOTEM, USER)).rejects.toMatchObject({
        status: 403,
      });
      // Nem abriu a transação: a segunda tranca não é desculpa para afrouxar a primeira.
      expect(rlsClaims).toHaveLength(0);
    });
  });

  /**
   * Ativar é quando o totem passa a operar. A RPC confere se a licença existe, está ativa e
   * é da empresa — **não** confere se é demo. Sem esta checagem, um totem configurado em
   * produção sobe com licença demo e manda NFC-e de verdade para a SEFAZ.
   */
  describe('demo não entra em operação na ativação', () => {
    const DEMO = [{ license_type: null, plan_slug: 'ecp-demo' }];

    it('config em produção + licença demo: 400 e a RPC NÃO roda', async () => {
      const { svc, calls } = fakeDb([PERTENCE, [{ app_mode: 'producao' }], DEMO]);
      await expect(
        svc.setTotemActive(COMPANY, TOTEM, { is_active: true, license_id: TOTEM }, USER),
      ).rejects.toMatchObject({ status: 400 });
      expect(calls.some((c) => c.sql.includes('cloud_set_totem_active'))).toBe(false);
    });

    it('config em produção + licença real: passa', async () => {
      const { svc, calls } = fakeDb([
        PERTENCE,
        [{ app_mode: 'producao' }],
        [{ license_type: 'yearly', plan_slug: 'pro' }],
        [{ ok: true }],
      ]);
      await svc.setTotemActive(COMPANY, TOTEM, { is_active: true, license_id: TOTEM }, USER);
      expect(calls.some((c) => c.sql.includes('cloud_set_totem_active'))).toBe(true);
    });

    it('DESATIVAR nunca é barrado — senão um totem demo mal configurado não desliga', async () => {
      const { svc, calls } = fakeDb([PERTENCE, [{ ok: true }]]);
      await svc.setTotemActive(COMPANY, TOTEM, { is_active: false }, USER);
      expect(calls.some((c) => c.sql.includes('cloud_set_totem_active'))).toBe(true);
    });
  });

  describe('agente — o tenant vai no próprio WHERE', () => {
    it('o update carrega company_id, não só o id', async () => {
      const { svc, calls } = fakeDb([[{ id: AGENT }]]);
      await svc.setAgentActive(COMPANY, AGENT, false);
      // Correção literal do `.update({is_active}).eq("id", id)` do browser.
      expect(calls[0].sql).toContain('where id = $1::uuid and company_id = $2::uuid');
      expect(calls[0].params).toEqual([AGENT, COMPANY, false]);
    });

    it('usa returning — zero linhas vira 403, não 200 silencioso', async () => {
      const { svc, calls } = fakeDb([[]]);
      await expect(svc.setAgentActive(COMPANY, AGENT, false)).rejects.toMatchObject({ status: 403 });
      expect(calls[0].sql).toContain('returning id');
    });

    it('desativar agente da propria empresa funciona', async () => {
      const { svc } = fakeDb([[{ id: AGENT }]]);
      await expect(svc.setAgentActive(COMPANY, AGENT, false)).resolves.toEqual({
        ok: true,
        id: AGENT,
      });
    });
  });

  describe('license_id: ausente ≠ null', () => {
    /** A RPC é a última query; achá-la pelo nome evita quebrar quando entra uma leitura antes. */
    const rpc = (calls: Array<{ sql: string; params: unknown[] }>) =>
      calls.find((c) => c.sql.includes('cloud_set_totem_active'))!;

    it('ausente NÃO mexe no vínculo (manda null para a RPC sem intenção de desvincular)', async () => {
      const { svc, calls } = fakeDb([PERTENCE, [{ app_mode: 'demo' }], [{}]]);
      await svc.setTotemActive(COMPANY, TOTEM, { is_active: true }, USER);
      expect(rpc(calls).params[2]).toBeNull();
    });

    it('null explícito desvincula', async () => {
      const { svc, calls } = fakeDb([PERTENCE, [{}]]);
      await svc.setTotemActive(COMPANY, TOTEM, { is_active: false, license_id: null }, USER);
      expect(rpc(calls).params[2]).toBeNull();
    });

    it('id de licença é repassado', async () => {
      const LIC = '44444444-4444-4444-8444-444444444444';
      const { svc, calls } = fakeDb([PERTENCE, [{ app_mode: 'demo' }], [{}]]);
      await svc.setTotemActive(COMPANY, TOTEM, { is_active: true, license_id: LIC }, USER);
      expect(rpc(calls).params[2]).toBe(LIC);
    });
  });

  describe('PIXnoPDV — a presença do campo decide, não o valor', () => {
    const ANTERIOR = [
      {
        api_base_url: 'https://antigo',
        basic_user: 'user1',
        basic_token: 'TOKEN-ANTIGO',
        secret_key: 'SEGREDO-ANTIGO',
        insecure_tls: false,
        enabled: true,
      },
    ];

    it('campo AUSENTE mantém o segredo gravado — o bug que esta regra evita', async () => {
      const { svc, calls } = fakeDb([ANTERIOR, [{ store_id: STORE }]]);
      // A tela nunca recebe o segredo de volta; salvar o formulário sem esta regra
      // mandaria basic_token vazio e APAGARIA a credencial em produção.
      await svc.savePixnopdv(COMPANY, STORE, { enabled: false });
      const params = calls[1].params;
      expect(params).toContain('TOKEN-ANTIGO');
      expect(params).toContain('SEGREDO-ANTIGO');
    });

    it('campo PRESENTE com string vazia apaga (intencional)', async () => {
      const { svc, calls } = fakeDb([ANTERIOR, [{ store_id: STORE }]]);
      await svc.savePixnopdv(COMPANY, STORE, { basic_token: '' });
      expect(calls[1].params).not.toContain('TOKEN-ANTIGO');
      // O secret_key, que NÃO veio no payload, permanece.
      expect(calls[1].params).toContain('SEGREDO-ANTIGO');
    });

    it('campo presente com valor novo substitui', async () => {
      const { svc, calls } = fakeDb([ANTERIOR, [{ store_id: STORE }]]);
      await svc.savePixnopdv(COMPANY, STORE, { basic_token: 'NOVO' });
      expect(calls[1].params).toContain('NOVO');
      expect(calls[1].params).not.toContain('TOKEN-ANTIGO');
    });

    it('a resposta NUNCA devolve os segredos', async () => {
      const { svc } = fakeDb([ANTERIOR, [{ store_id: STORE }]]);
      const r = await svc.savePixnopdv(COMPANY, STORE, {});
      expect(r).not.toHaveProperty('basic_token');
      expect(r).not.toHaveProperty('secret_key');
      expect(r.basic_token_set).toBe(true);
      expect(r.secret_key_set).toBe(true);
    });

    it('sem credencial anterior, os _set refletem o que foi enviado', async () => {
      const { svc } = fakeDb([[], [{ store_id: STORE }]]);
      const r = await svc.savePixnopdv(COMPANY, STORE, { basic_token: 'X' });
      expect(r.basic_token_set).toBe(true);
      expect(r.secret_key_set).toBe(false);
      // `enabled` sem registro anterior nasce true — é o default de hoje.
      expect(r.enabled).toBe(true);
    });

    it('a URL perde a barra final (evita // nas chamadas do serviço)', async () => {
      const { svc, calls } = fakeDb([[], [{ store_id: STORE }]]);
      await svc.savePixnopdv(COMPANY, STORE, { api_base_url: 'https://x.com/api/' });
      expect(calls[1].params).toContain('https://x.com/api');
    });

    it('empresa e loja entram no INSERT e na condição do UPDATE', async () => {
      const { svc, calls } = fakeDb([[], [{ store_id: STORE }]]);
      await svc.savePixnopdv(COMPANY, STORE, {});
      expect(calls[1].params[0]).toBe(COMPANY);
      expect(calls[1].params[1]).toBe(STORE);
      expect(calls[1].sql).toContain('company_id = $1::uuid');
      expect(calls[1].sql).toContain('store_id = $2::uuid');
      // Reenviar o mesmo formulário atualiza, não duplica.
      expect(calls[1].sql).toContain('on conflict (company_id, store_id, environment)');
    });

    it('a leitura do anterior também é filtrada por empresa e loja', async () => {
      const { svc, calls } = fakeDb([[], [{ store_id: STORE }]]);
      await svc.savePixnopdv(COMPANY, STORE, {});
      expect(calls[0].params).toEqual([COMPANY, STORE]);
    });
  });

describe('agente — criacao e edicao', () => {
  /** withTransaction: o fake entrega um client que registra as queries da transacao. */
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
      withClaims: vi.fn(async (_claims: any, fn: any) => fn(client)),
    } as unknown as DbService;
    return { calls, svc: montarEscritas(db), db };
  }

  it('criacao: company_id e store_id saem da SESSAO, nao do corpo', async () => {
    const { svc, calls } = fakeTx([[{ id: AGENT }], []]);
    await svc.createAgent(COMPANY, STORE, { agent_name: 'Agente 1', log_level: 'info' }, 'user-1');
    expect(calls[0].sql).toContain('insert into public.vw_nfce_service_agent (company_id, store_id');
    expect(calls[0].params[0]).toBe(COMPANY);
    expect(calls[0].params[1]).toBe(STORE);
  });

  it('criacao: a auditoria vai na MESMA transacao do insert', async () => {
    const { svc, calls, db } = fakeTx([[{ id: AGENT }], []]);
    await svc.createAgent(COMPANY, STORE, { agent_name: 'A' }, 'user-1');
    // Criar o agente e perder o rastro de quem o criou e pior que falhar os dois.
    expect((db as any).withTransaction).toHaveBeenCalled();
    expect(calls).toHaveLength(2);
    expect(calls[1].sql).toContain('vw_nfce_service_agent_audit');
    expect(calls[1].params).toContain('user-1');
  });

  it('edicao: o SELECT do anterior ja filtra por empresa', async () => {
    const { svc, calls } = fakeTx([[{ log_level: 'info' }], [{ id: AGENT }], []]);
    await svc.updateAgent(COMPANY, AGENT, { log_level: 'debug' }, 'user-1');
    expect(calls[0].sql).toContain('where id = $1::uuid and company_id = $2::uuid');
    expect(calls[0].params).toEqual([AGENT, COMPANY]);
  });

  it('edicao: agente de outra empresa da 403 sem escrever', async () => {
    const { svc, calls } = fakeTx([[]]);
    await expect(
      svc.updateAgent(COMPANY, AGENT, { log_level: 'debug' }, 'user-1'),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls).toHaveLength(1);
  });

  it('edicao: o UPDATE tambem leva o company_id', async () => {
    const { svc, calls } = fakeTx([[{ log_level: 'info' }], [{ id: AGENT }], []]);
    await svc.updateAgent(COMPANY, AGENT, { log_level: 'debug' }, 'user-1');
    expect(calls[1].sql).toContain('where id = $1::uuid and company_id = $2::uuid');
    expect(calls[1].sql).toContain('returning id');
  });

  it('edicao: a auditoria grava SO o que mudou de fato', async () => {
    const { svc, calls } = fakeTx([
      [{ log_level: 'info', api_rate_limit: 100 }],
      [{ id: AGENT }],
      [],
    ]);
    const r = await svc.updateAgent(
      COMPANY, AGENT, { log_level: 'debug', api_rate_limit: 100 }, 'user-1',
    );
    expect(r.changed).toEqual(['log_level']);
    const audit = calls[2];
    expect(audit.params[2]).toEqual(['log_level']);
    expect(JSON.parse(String(audit.params[3]))).toEqual({ log_level: 'info' });
    expect(JSON.parse(String(audit.params[4]))).toEqual({ log_level: 'debug' });
  });

  it('edicao sem mudanca real NAO gera registro de auditoria', async () => {
    const { svc, calls } = fakeTx([[{ log_level: 'info' }], [{ id: AGENT }]]);
    const r = await svc.updateAgent(COMPANY, AGENT, { log_level: 'info' }, 'user-1');
    // Auditoria cheia de linha vazia e auditoria que ninguem le.
    expect(r.changed).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('edicao sem campo nenhum nao vai ao banco', async () => {
    const { svc, calls } = fakeTx([]);
    await expect(svc.updateAgent(COMPANY, AGENT, {}, 'user-1')).resolves.toEqual({
      ok: true, changed: [],
    });
    expect(calls).toHaveLength(0);
  });
});
});
