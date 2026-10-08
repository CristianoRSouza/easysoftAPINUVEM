import { describe, expect, it } from 'vitest';
import {
  caminhoDoXmlDaInutilizacao,
  caminhoDoXmlDaNota,
  caminhoDoXmlDoEvento,
  nomeBaseDaNota,
} from '../src/modules/storage/domain/fiscal-xml-path';

/**
 * Caminhos no bucket `fiscal-xml` (Fase 1 da migração D7).
 *
 * O que estes testes protegem não é o formato da string — é que o documento fiscal fique
 * ONDE o contador vai procurar. Um caminho errado não quebra nada: o upload passa, a linha
 * grava, e a nota some do mês em que foi emitida.
 */

const COMPANY = '11111111-1111-1111-1111-111111111111';
const STORE = '22222222-2222-2222-2222-222222222222';
const CHAVE = '35260712345678000199650010000011641000011648';
const BASE = { companyId: COMPANY, storeId: STORE, model: '65' };

describe('caminhoDoXmlDaNota', () => {
  it('põe a nota em {company}/{store}/{model}/{ano}/{mes}/{chave}/{kind}.xml', () => {
    expect(
      caminhoDoXmlDaNota({
        ...BASE,
        issuedAt: '2026-07-31T18:21:00-03:00',
        nota: { accessKey: CHAVE },
        kind: 'authorized',
      }),
    ).toBe(`${COMPANY}/${STORE}/65/2026/07/${CHAVE}/authorized.xml`);
  });

  /**
   * O teste que justifica o módulo existir.
   *
   * `dhEmi` traz o offset do emitente, então 31/12 23h30 BRT É dezembro de 2026 — mas em UTC
   * já é 1/1/2027. Se alguém trocar o corte da string por `new Date(...).getUTCFullYear()`,
   * a nota vai para o ano fiscal seguinte e este teste é o único que acusa.
   */
  it('vira do ano: 31/12 23h30 BRT fica em 2026/12, NUNCA em 2027/01', () => {
    const p = caminhoDoXmlDaNota({
      ...BASE,
      issuedAt: '2026-12-31T23:30:00-03:00',
      nota: { accessKey: CHAVE },
      kind: 'authorized',
    });
    expect(p).toContain('/2026/12/');
    expect(p).not.toContain('/2027/');
  });

  it('nota sem chave cai num nome estável, derivado de número/série/id', () => {
    expect(
      caminhoDoXmlDaNota({
        ...BASE,
        issuedAt: '2026-07-31T18:21:00-03:00',
        nota: { accessKey: null, number: 1164, serie: 2, noteId: 'abcdef12-3456-7890-abcd-ef1234567890' },
        kind: 'signed',
      }),
    ).toBe(`${COMPANY}/${STORE}/65/2026/07/sem-chave-000001164-002-abcdef12/signed.xml`);
  });

  it('cancelamento é outro arquivo na MESMA pasta da nota', () => {
    const autorizada = caminhoDoXmlDaNota({
      ...BASE,
      issuedAt: '2026-07-31T18:21:00-03:00',
      nota: { accessKey: CHAVE },
      kind: 'authorized',
    });
    const cancelada = caminhoDoXmlDaNota({
      ...BASE,
      issuedAt: '2026-07-31T18:21:00-03:00',
      nota: { accessKey: CHAVE },
      kind: 'cancellation',
    });
    expect(cancelada.replace('cancellation.xml', '')).toBe(autorizada.replace('authorized.xml', ''));
  });

  it('data sem forma de ISO é recusada (400), em vez de gerar caminho torto', () => {
    expect(() =>
      caminhoDoXmlDaNota({
        ...BASE,
        issuedAt: '31/07/2026',
        nota: { accessKey: CHAVE },
        kind: 'authorized',
      }),
    ).toThrow(/Data de emissão inválida/);
  });
});

describe('caminhoDoXmlDoEvento', () => {
  it('pendura o evento na pasta da nota, no mês da NOTA', () => {
    expect(
      caminhoDoXmlDoEvento({
        ...BASE,
        noteIssuedAt: '2026-07-31T18:21:00-03:00',
        nota: { accessKey: CHAVE },
        eventType: '110111',
        eventSequence: 1,
        kind: 'request',
      }),
    ).toBe(`${COMPANY}/${STORE}/65/2026/07/${CHAVE}/event-110111-001.xml`);
  });

  it('a resposta fica ao lado do pedido, com sufixo próprio', () => {
    expect(
      caminhoDoXmlDoEvento({
        ...BASE,
        noteIssuedAt: '2026-07-31T18:21:00-03:00',
        nota: { accessKey: CHAVE },
        eventType: '110111',
        eventSequence: 1,
        kind: 'response',
      }),
    ).toBe(`${COMPANY}/${STORE}/65/2026/07/${CHAVE}/event-110111-001-resposta.xml`);
  });
});

describe('caminhoDoXmlDaInutilizacao', () => {
  /**
   * Fora da árvore de chave, porque inutilização não tem chave de acesso — e COM o prefixo
   * de tenant, que o comentário do EasyML omite. Sem ele, a faixa de uma empresa cairia na
   * raiz de um bucket compartilhado entre produtos.
   */
  it('usa a faixa como nome, sob {ano}/inutilizations, com prefixo de tenant', () => {
    expect(
      caminhoDoXmlDaInutilizacao({
        ...BASE,
        year: 2026,
        serie: 2,
        numberStart: 1160,
        numberEnd: 1163,
      }),
    ).toBe(`${COMPANY}/${STORE}/65/2026/inutilizations/002-000001160-000001163.xml`);
  });
});

describe('nomeBaseDaNota — a regra compartilhada com o ZIP', () => {
  it('chave de acesso vence', () => {
    expect(nomeBaseDaNota({ accessKey: CHAVE, number: 1, serie: 1, noteId: 'x' })).toBe(CHAVE);
  });

  it('chave curta demais não é chave — cai no fallback', () => {
    expect(nomeBaseDaNota({ accessKey: '123', number: 7, serie: 1, noteId: 'deadbeef-0000' })).toBe(
      'sem-chave-000000007-001-deadbeef',
    );
  });

  it('sem id nenhum ainda produz nome (não vaza string vazia para o caminho)', () => {
    expect(nomeBaseDaNota({})).toBe('sem-chave-000000000-000-semid');
  });
});
