import { describe, expect, it, vi } from 'vitest';
import { NfceService } from '../src/modules/nfce/application/nfce.service';
import { NfceXmlRepository } from '../src/modules/nfce/infrastructure/nfce-xml.repository';
import { NfceRepository } from '../src/modules/nfce/infrastructure/nfce.repository';
import {
  nfceAttentionCountsSchema,
  nfceEventSchema,
  nfceDetailSchema,
  nfceListResultSchema,
  nfceLogSchema,
  nfcePaymentSchema,
} from '../src/contract/nfce.schema';
import type { DbService } from '../src/db/db.service';

const STORE = '33333333-3333-4333-8333-333333333333';
const NOTE = '77777777-7777-4777-8777-777777777777';
const COMPANY = '11111111-1111-4111-8111-111111111111';

function fakeDb(rows: any[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows };
    }),
  } as unknown as DbService;
  return { db, calls, svc: new NfceService(new NfceRepository(db), new NfceXmlRepository(db)) };
}

const baseQuery = { page: 1, limit: 50 };

describe('NfceService — documento fiscal, com a amarra de loja que a RLS fazia', () => {
  describe('a nota tem que ser DA LOJA (o role da API tem BYPASSRLS)', () => {
    it.each([
      ['payments', (s: NfceService) => s.payments(STORE, NOTE)],
      ['logs', (s: NfceService) => s.logs(STORE, NOTE)],
      ['events', (s: NfceService) => s.events(STORE, NOTE)],
    ])('%s confere o vínculo nota↔loja antes de devolver', async (_nome, chamar) => {
      const { svc, calls } = fakeDb();
      await chamar(svc);
      // Sem este exists, um note_id alheio leria a nota de outra empresa.
      expect(calls[0].sql).toContain('exists (select 1 from public.vw_nfce_notes n');
      expect(calls[0].sql).toContain('n.store_id = $2::uuid');
      expect(calls[0].params).toEqual([NOTE, STORE]);
    });

    it('nota de outra loja devolve lista vazia, não erro', async () => {
      const { svc } = fakeDb([]);
      await expect(svc.payments(STORE, NOTE)).resolves.toEqual([]);
      await expect(svc.logs(STORE, NOTE)).resolves.toEqual([]);
      await expect(svc.events(STORE, NOTE)).resolves.toEqual([]);
    });

    it('lista e contadores filtram pela loja', async () => {
      const { svc, calls } = fakeDb();
      await svc.attentionCounts(STORE);
      await svc.list(STORE, baseQuery);
      expect(calls[0].sql).toContain('store_id = $1::uuid');
      expect(calls[1].sql).toContain('n.store_id = $1::uuid');
      expect(calls[0].params[0]).toBe(STORE);
      expect(calls[1].params[0]).toBe(STORE);
    });
  });

  describe('contadores de atenção', () => {
    it('três contagens numa consulta, e exatas (não a estimativa do planner)', async () => {
      const { svc, calls } = fakeDb([
        { manual_review: '3', reconcile_failed: '1', unusable: '0' },
      ]);
      const out = await svc.attentionCounts(STORE);
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toContain('count(*) filter');
      expect(out).toEqual({ manualReview: 3, reconcileFailed: 1, unusable: 0 });
      expect(() => nfceAttentionCountsSchema.parse(out)).not.toThrow();
    });

    it('reconcile_failed exclui nota cancelada/inutilizada', async () => {
      const { svc, calls } = fakeDb();
      await svc.attentionCounts(STORE);
      expect(calls[0].sql).toContain("not in ('cancelled', 'inutilized')");
    });
  });

  describe('listagem', () => {
    it('busca numérica inclui o número da nota; texto não tenta o cast', async () => {
      const { svc, calls } = fakeDb();
      await svc.list(STORE, { ...baseQuery, search: '12345' });
      expect(calls[0].sql).toContain('n.number =');
      expect(calls[0].params).toContain(12345);

      const b = fakeDb();
      await b.svc.list(STORE, { ...baseQuery, search: 'abc-def' });
      expect(b.calls[0].sql).not.toContain('n.number =');
    });

    it('busca escapa % e _ e vai parametrizada', async () => {
      const { svc, calls } = fakeDb();
      await svc.list(STORE, { ...baseQuery, search: '50%_x' });
      expect(calls[0].params).toContain('%50\\%\\_x%');
      expect(calls[0].sql).not.toContain('50%');
    });

    it('paginação: página 3 de 20 vira offset 40', async () => {
      const { svc, calls } = fakeDb();
      await svc.list(STORE, { page: 3, limit: 20 });
      expect(calls[0].params).toContain(20);
      expect(calls[0].params).toContain(40);
    });

    it('total é exato e sai da mesma consulta', async () => {
      const { svc, calls } = fakeDb([
        { id: NOTE, number: '10', serie: '1', total_value: '99.90', total_count: '512' },
      ]);
      const out = await svc.list(STORE, baseQuery);
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toContain('count(*) over()');
      expect(out.total).toBe(512);
      expect(() => nfceListResultSchema.parse(out)).not.toThrow();
    });

    it('sem linhas → total 0', async () => {
      const { svc } = fakeDb([]);
      await expect(svc.list(STORE, baseQuery)).resolves.toMatchObject({ total: 0, data: [] });
    });

    it('valor fiscal viaja como STRING (float arredondaria documento fiscal)', async () => {
      const { svc } = fakeDb([{ id: NOTE, number: '10', serie: '1', total_value: '1234.56' }]);
      const [n] = (await svc.list(STORE, baseQuery)).data;
      expect(n.valor_total).toBe('1234.56');
      expect(typeof n.valor_total).toBe('string');
    });

    it('qtd_itens vem contado da consulta, não fixo em 0', async () => {
      const { svc, calls } = fakeDb([{ id: NOTE, number: '72', serie: '1', qtd_itens: '7' }]);
      const [n] = (await svc.list(STORE, baseQuery)).data;
      expect(calls[0].sql).toContain('from public.vw_nfce_items where note_id = n.id');
      expect(n.qtd_itens).toBe(7);
    });

    it('nota sem itens → qtd_itens 0', async () => {
      const { svc } = fakeDb([{ id: NOTE, number: '10', serie: '1', qtd_itens: '0' }]);
      const [n] = (await svc.list(STORE, baseQuery)).data;
      expect(n.qtd_itens).toBe(0);
    });

    it('ordena por emissão desc com desempate estável', async () => {
      const { svc, calls } = fakeDb();
      await svc.list(STORE, baseQuery);
      expect(calls[0].sql).toContain('order by n.issued_at desc nulls last, n.id desc');
    });
  });

  describe('itens da nota — terceiro caso do padrão, corrigido na origem', () => {
    it('a loja entra em CADA join, não só na tabela de itens', async () => {
      const { svc, calls } = fakeDb();
      await svc.items(STORE, NOTE);
      expect(calls[0].sql).toContain('i.note_id = $1::uuid and i.store_id = $2::uuid');
      // Amarra DIRETA, não derivada: as views de imposto têm store_id, então não
      // dependemos de "o id veio de uma consulta que já filtrou" — dependência que
      // quebra em silêncio quando alguém reordena o código.
      // Espaçamento normalizado: o SQL alinha as colunas para leitura, e a asserção não
      // pode depender de quantos espaços alguém usou.
      const sql = calls[0].sql.replace(/\s+/g, ' ');
      for (const v of ['icms', 'pis', 'cof', 'tax']) {
        expect(sql, `join de ${v} sem amarra de loja`).toContain(`${v}.store_id = $2::uuid`);
      }
      expect(calls[0].params).toEqual([NOTE, STORE]);
    });

    it('é UMA consulta — no browser eram cinco (itens + 4 de imposto)', async () => {
      const { svc, calls } = fakeDb();
      await svc.items(STORE, NOTE);
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toContain('vw_nfce_items_icms');
      expect(calls[0].sql).toContain('vw_nfce_items_tax');
    });

    it('CST e CSOSN são excludentes — traz o que houver', async () => {
      const { svc, calls } = fakeDb();
      await svc.items(STORE, NOTE);
      expect(calls[0].sql).toContain('coalesce(icms.cst, icms.csosn)');
    });

    it('imposto ausente vira null, NÃO "0" — são coisas diferentes na nota', async () => {
      const { svc } = fakeDb([
        {
          item: '1',
          descricao: 'AGUA COM GAS',
          codigo_produto: '123',
          quantidade: '1.0000',
          preco_unitario: '3.50',
          valor_bruto: '3.50',
          icms_valor: null,
          pis_valor: '0.00',
          total_tributos: null,
          icms_origem: '0',
          ean: null,
        },
      ]);
      const [i] = await svc.items(STORE, NOTE);
      expect(i.icms_valor).toBeNull();
      // Zero informado continua "0.00" — nota com imposto zerado não é nota sem imposto.
      expect(i.pis_valor).toBe('0.00');
      expect(i.total_tributos).toBeNull();
      expect(i.ean).toBeNull();
      expect(i.icms_origem).toBe(0);
    });

    it('valor fiscal viaja como string; item é número', async () => {
      const { svc } = fakeDb([
        { item: '7', quantidade: '2.5000', valor_bruto: '17.50', descricao: 'X' },
      ]);
      const [i] = await svc.items(STORE, NOTE);
      expect(i.item).toBe(7);
      expect(i.quantidade).toBe('2.5000');
      expect(typeof i.valor_bruto).toBe('string');
    });

    it('nota de outra loja devolve lista vazia', async () => {
      const { svc } = fakeDb([]);
      await expect(svc.items(STORE, NOTE)).resolves.toEqual([]);
    });
  });

  describe('detalhe da nota', () => {
    it('filtra por nota E loja na raiz da junção — id alheio não casa', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.detail(STORE, NOTE);
      expect(calls[0].sql).toContain('where n.id = $1::uuid and n.store_id = $2::uuid');
      expect(calls[0].params).toEqual([NOTE, STORE]);
    });

    it('nota inexistente ou de outra loja devolve null, não erro', async () => {
      const { svc } = fakeDb([]);
      await expect(svc.detail(STORE, NOTE)).resolves.toBeNull();
    });

    it('usa LEFT JOIN — nota sem destinatário é o caso NORMAL numa NFC-e', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.detail(STORE, NOTE);
      expect(calls[0].sql).toContain('left join public.vw_nfce_recipient');
      expect(calls[0].sql).not.toContain('inner join');
    });

    it('junta as 5 filhas numa consulta só (browser faz 6 chamadas)', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.detail(STORE, NOTE);
      expect(calls).toHaveLength(1);
      for (const v of ['identification', 'issuer', 'recipient', 'additional_info', 'payments']) {
        expect(calls[0].sql).toContain(`vw_nfce_${v}`);
      }
    });

    it('dinheiro sai como STRING; código como número; data como ISO', async () => {
      const { svc } = fakeDb([
        {
          id: NOTE,
          numero: '20',
          serie: '1',
          status: 'authorized',
          valor_total: 123,
          total_nota: 123,
          total_icms: null,
          ambiente: '2',
          tipo_emissao: null,
          emissao_em: new Date('2026-07-30T12:00:00.000Z'),
          cancelled_at: null,
          emitente_cnpj: '13971933000178',
          emitente_uf: 'SP',
          emitente_razao: null,
        },
      ]);
      const d = (await svc.detail(STORE, NOTE))!;
      expect(d.valor_total).toBe('123');
      expect(typeof d.valor_total).toBe('string');
      // Total ausente vira "0", não null: a tela soma esses campos.
      expect(d.total_icms).toBe('0');
      expect(d.numero).toBe(20);
      expect(d.ambiente).toBe(2);
      // Código fiscal ausente é null, não 0 — 0 é um código válido.
      expect(d.tipo_emissao).toBeNull();
      expect(d.emissao_em).toBe('2026-07-30T12:00:00.000Z');
      expect(d.cancelled_at).toBeNull();
      expect(d.emitente_razao).toBe('');
      expect(() => nfceDetailSchema.parse(d)).not.toThrow();
    });
  });

  describe('emitente — a regra do CSC (decisao do usuario, opcao 3)', () => {
    it('o valor do CSC so vai quando ehAdmin', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.issuerConfig(COMPANY, STORE, true);
      await svc.issuerConfig(COMPANY, STORE, false);
      expect(calls[0].params).toEqual([STORE, COMPANY, true]);
      expect(calls[1].params).toEqual([STORE, COMPANY, false]);
      // Quem decide e o SQL, com o booleano — nao um `if` depois de ja ter lido o valor.
      expect(calls[0].sql.replace(/\s+/g, ' ')).toContain(
        "case when $3::boolean then coalesce(nullif(btrim(ic.nfce_security_code), ''), s.nfce_security_code) else null end",
      );
    });

    it('o par _set vai para os dois — a tela sabe que existe sem ver o valor', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.issuerConfig(COMPANY, STORE, false);
      expect(calls[0].sql).toContain('as nfce_security_code_set');
    });

    it('senha do certificado e tokens TEF vem SEMPRE null', async () => {
      const { svc } = fakeDb([{ id: STORE, nfce_security_code: 'ABC', certificate_password: 'nao-deveria', aditum_tef_partner_token: 'nem-isso' }]);
      const [cfg] = await svc.issuerConfig(COMPANY, STORE, true);
      for (const k of ['certificate_password','aditum_tef_partner_token','aditum_tef_activation_code','tef_admin_http_api_key']) {
        expect(cfg[k], `${k} deveria vir null`).toBeNull();
      }
    });

    it('a chave de API sai mascarada, nunca completa', async () => {
      const { svc } = fakeDb([{ id: STORE, api_key_prefix: 'sk_live_abc' }]);
      const [cfg] = await svc.issuerConfig(COMPANY, STORE, true);
      expect(cfg.apikey_easyerp).toBe('sk_live_abc••••••••');
    });

    it('sem chave ativa, apikey_easyerp e null (nao string vazia)', async () => {
      const { svc } = fakeDb([{ id: STORE, api_key_prefix: null }]);
      const [cfg] = await svc.issuerConfig(COMPANY, STORE, true);
      expect(cfg.apikey_easyerp).toBeNull();
    });

    it('devolve LISTA de 0 ou 1 — formato que a tela ja consome', async () => {
      const { svc } = fakeDb([]);
      await expect(svc.issuerConfig(COMPANY, STORE, true)).resolves.toEqual([]);
      const b = fakeDb([{ id: STORE }]);
      await expect(b.svc.issuerConfig(COMPANY, STORE, true)).resolves.toHaveLength(1);
    });

    it('regime vem do emitente sincronizado, sem inventar "Regime Normal"', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.issuerConfig(COMPANY, STORE, true);
      // pv_stores.tax_regime_id nunca e preenchido; o CRT real esta em nfce.issuer_config.
      expect(calls[0].sql).toContain('from nfce.issuer_config');
      expect(calls[0].sql).toContain('coalesce(ic.tax_regime_code, nullif(btrim(tr.code::text), \'\')::int)');
      // O default 3 fazia um emitente do Simples aparecer como Regime Normal.
      expect(calls[0].sql).not.toMatch(/::int,\s*3\)/);
    });

    it('series, PIS/COFINS, IE ST e infCpl vem do emitente sincronizado', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.issuerConfig(COMPANY, STORE, false);
      const sql = calls[0].sql.replace(/\s+/g, ' ');
      expect(sql).toContain('coalesce(ic.nfce_serie, case when btrim(s.nfce_series)');
      expect(sql).toContain('coalesce(ic.nfe_serie, case when btrim(s.nfe_series)');
      expect(sql).toContain('ic.state_registration_st');
      expect(sql).toContain('ic.inf_ad_fb_config_250');
      expect(sql).toContain('ic.inf_ad_fb_config_251');
      expect(sql).toContain('coalesce(ic.pis_cofins_regime_code::int');
    });

    it('certificado vem do certificado ativo, nos nomes que a tela le', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.issuerConfig(COMPANY, STORE, false);
      const sql = calls[0].sql.replace(/\s+/g, ' ');
      // pv_stores.certificate_* nunca e preenchido; a tela mostrava Titular/CNPJ/AC vazios.
      expect(sql).toContain("coalesce(nullif(btrim(cert.subject_name), ''), s.certificate_legal_name) as certificate_holder_name");
      expect(sql).toContain("coalesce(nullif(btrim(cert.subject_cnpj), ''), s.certificate_cnpj) as certificate_holder_cnpj");
      expect(sql).toContain("coalesce(nullif(btrim(cert.issuer_name), ''), s.certificate_authority) as certificate_authority_name");
      expect(sql).toContain('as certificate_series');
      expect(sql).toContain('as certificate_type,');
      expect(sql).toContain('coalesce(cert.valid_until, s.certificate_expiry_date) as certificate_valid_until');
    });

    it('caminhos, exportação e flags do certificado vêm do emitente sincronizado', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.issuerConfig(COMPANY, STORE, false);
      const sql = calls[0].sql.replace(/\s+/g, ' ');
      expect(sql).toContain('coalesce(ic.certificate_pfx_relative_path, s.certificate_path) as certificate_pfx_relative_path');
      expect(sql).toContain('ic.certificate_source_path');
      expect(sql).toContain('ic.certificate_exported_at');
      expect(sql).toContain('coalesce(ic.crypto_library_flag, s.crypto_library) as crypto_library_flag');
      expect(sql).toContain('coalesce(ic.certificate_access_flag, s.certificate_access) as certificate_access_flag');
    });

    it('chave: da nuvem ou da loja, e a tela sabe qual', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.issuerConfig(COMPANY, STORE, false);
      const sql = calls[0].sql.replace(/\s+/g, ' ');
      expect(sql).toContain('(ak.key_prefix is not null or coalesce(ic.apikey_easyerp_set, false)) as easyerp_api_key_set');
      expect(sql).toContain("when coalesce(ic.apikey_easyerp_set, false) then 'loja' end as easyerp_api_key_origem");
    });

    it('TEF Aditum e TEF Admin: só os indicadores, nos nomes da Admin API local', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.issuerConfig(COMPANY, STORE, false);
      const sql = calls[0].sql.replace(/\s+/g, ' ');
      expect(sql).toContain('coalesce(ic.aditum_tef_partner_token_set, false) as aditum_tef_partner_token_encrypted_set');
      expect(sql).toContain('coalesce(ic.aditum_tef_activation_code_set, false) as aditum_tef_activation_code_encrypted_set');
      expect(sql).toContain('ic.tef_admin_http_base_url');
      expect(sql).toContain('coalesce(ic.tef_admin_http_api_key_set, false) as tef_admin_http_api_key_set');
    });

    it('filtra por loja E empresa, e ignora loja apagada', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.issuerConfig(COMPANY, STORE, true);
      expect(calls[0].sql).toContain('s.id = $1::uuid');
      expect(calls[0].sql).toContain('s.company_id = $2::uuid');
      expect(calls[0].sql).toContain('is_deleted');
    });
  });

  describe('acbrConfig', () => {
    it('lê só a loja E a empresa da sessão, por chave', async () => {
      const { svc, calls } = fakeDb([]);
      await svc.acbrConfig(COMPANY, STORE);
      const sql = calls[0].sql.replace(/\s+/g, ' ');
      expect(sql).toContain('from nfce.acbr_config');
      expect(sql).toContain('where company_id = $1::uuid and store_id = $2::uuid');
      expect(sql).toContain('order by key');
      expect(calls[0].params).toEqual([COMPANY, STORE]);
    });

    it('devolve o formato que a tela já consome', async () => {
      const { svc } = fakeDb([
        { id: 'x', key: 'timeout_sefaz_ms', value: 30000, description: null, updated_at: new Date('2026-09-29T12:00:12Z') },
      ]);
      await expect(svc.acbrConfig(COMPANY, STORE)).resolves.toEqual([
        { id: 'x', key: 'timeout_sefaz_ms', value: '30000', description: null, updated_at: '2026-09-29T12:00:12.000Z' },
      ]);
    });
  });

  describe('mapeamento', () => {
    it('pagamento resolve os rótulos fiscais para a tela', async () => {
      const { svc } = fakeDb([
        {
          payment_number: '1',
          payment_method: '17',
          payment_value: '50.00',
          change_value: null,
          integration_type: '1',
          card_brand: '06',
          authorization_number: 'NSU123',
          acquirer_cnpj: null,
        },
      ]);
      const [p] = await svc.payments(STORE, NOTE);
      expect(p.forma_descricao).toBe('PIX');
      expect(p.bandeira_descricao).toBe('Elo');
      expect(p.integracao_descricao).toBe('TEF Integrado');
      expect(p.valor).toBe('50.00');
      expect(p.troco).toBeNull();
      expect(() => nfcePaymentSchema.parse(p)).not.toThrow();
    });

    it('forma de pagamento desconhecida cai no próprio código, não em branco', async () => {
      const { svc } = fakeDb([{ payment_number: '1', payment_method: '77', payment_value: '1' }]);
      const [p] = await svc.payments(STORE, NOTE);
      expect(p.forma_descricao).toBe('77');
      expect(p.bandeira_descricao).toBeNull();
      expect(p.integracao_descricao).toBeNull();
    });

    it('log serializa details jsonb para string', async () => {
      const { svc } = fakeDb([
        {
          id: 'l1',
          created_at: new Date('2026-07-30T12:00:00.000Z'),
          level: 'error',
          message: 'falhou',
          details: { code: 539 },
        },
      ]);
      const [l] = await svc.logs(STORE, NOTE);
      expect(l.details).toBe('{"code":539}');
      expect(l.created_at).toBe('2026-07-30T12:00:00.000Z');
      expect(() => nfceLogSchema.parse(l)).not.toThrow();
    });

    it('log com details já em texto não é serializado duas vezes', async () => {
      const { svc } = fakeDb([{ id: 'l1', level: 'info', message: 'ok', details: 'texto puro' }]);
      const [l] = await svc.logs(STORE, NOTE);
      expect(l.details).toBe('texto puro');
    });

    it('evento respeita o contrato, com registered_at opcional', async () => {
      const { svc } = fakeDb([
        {
          id: 'e1',
          event_type: '110111',
          event_sequence: '1',
          event_at: new Date('2026-07-30T12:00:00.000Z'),
          registered_at: null,
          created_at: new Date('2026-07-30T12:00:00.000Z'),
        },
      ]);
      const [e] = await svc.events(STORE, NOTE);
      expect(e.event_sequence).toBe(1);
      expect(e.registered_at).toBeNull();
      expect(() => nfceEventSchema.parse(e)).not.toThrow();
    });
  });
});
