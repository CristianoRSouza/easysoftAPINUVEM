import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { NfceXmlController } from '../src/modules/nfce/http/nfce-xml.controller';
import type { NfceService } from '../src/modules/nfce/application/nfce.service';
import type { NfceXmlArchiveRow } from '../src/modules/nfce/domain/nfce-xml-archive-entries';

/**
 * A rota `GET /nfce/xml-archive` como o navegador a vê.
 *
 * O que se testa aqui é o que só aparece no HTTP e não no montador do ZIP:
 *   • o cabeçalho sai DEPOIS da primeira leitura do banco (falha vira 500 JSON, não um
 *     .zip corrompido que o usuário só descobre ao tentar abrir);
 *   • falha no MEIO derruba a conexão em vez de encerrar limpo — encerrar limpo
 *     entregaria um pacote incompleto com cara de sucesso;
 *   • o socket cheio faz a montagem esperar `drain` (é isso que evita o ZIP inteiro
 *     acumular na memória do processo, que é a razão de existir o streaming).
 */

const STORE = '33333333-3333-4333-8333-333333333333';
const CHAVE = '35260413971933000178650020000011641837486150';

function nota(over: Partial<NfceXmlArchiveRow> = {}): NfceXmlArchiveRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    number: 1164,
    serie: 2,
    access_key: CHAVE,
    status: 'authorized',
    issued_at: '2026-07-31T18:21:00.000Z',
    // ⟨Fase 5⟩ o XML vive no acervo; a linha traz a referência.
    authorized_xml: null,
    cancellation_xml: null,
    signed_xml: null,
    generated_xml: null,
    storage_authorized_xml_bucket: 'fiscal-xml',
    storage_authorized_xml_path: 'co/loja/65/2026/07/CHAVE/authorized.xml',
    storage_authorized_xml_bytes: 29,
    ...over,
  };
}

/** O que o acervo devolve neste teste — o controller injeta o download no montador. */
const XML_DO_ACERVO = '<nfeProc>autorizada</nfeProc>';

/** Response do Express, o mínimo que o handler usa — e com o `write` controlável. */
class FakeRes extends EventEmitter {
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];
  ended = false;
  destroyed = false;
  writableEnded = false;
  statusCode = 0;
  /** `false` simula socket cheio: a montagem tem de esperar o `drain`. */
  aceitarWrite = true;

  status(c: number) {
    this.statusCode = c;
    return this;
  }
  setHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  write(b: Buffer) {
    this.chunks.push(Buffer.from(b));
    return this.aceitarWrite;
  }
  end() {
    this.ended = true;
    this.writableEnded = true;
  }
  destroy() {
    this.destroyed = true;
  }
  get zip() {
    return unzipSync(new Uint8Array(Buffer.concat(this.chunks)));
  }
}

function controller(xmlArchiveBatch: NfceService['xmlArchiveBatch']) {
  return new NfceXmlController({
    xmlArchiveBatch,
    baixarXmlDoStorage: async () => XML_DO_ACERVO,
  } as unknown as NfceService);
}

const req = { storeId: STORE, companyId: 'c' } as any;

describe('GET /nfce/xml-archive', () => {
  it('anuncia um anexo .zip com o período no nome e entrega o XML íntegro', async () => {
    let chamada = 0;
    const res = new FakeRes();
    await controller(vi.fn(async () => (chamada++ === 0 ? [nota()] : [])) as any).xmlArchive(
      req,
      { from: '2026-07-01', to: '2026-07-31' } as any,
      res as any,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/zip');
    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename="nfce-xml-2026-07-01-a-2026-07-31.zip"',
    );
    // Sem Content-Length: o pacote é montado ENQUANTO é enviado.
    expect(res.headers).not.toHaveProperty('Content-Length');
    expect(res.ended).toBe(true);
    expect(res.destroyed).toBe(false);
    expect(strFromU8(res.zip[`autorizadas/${CHAVE}.xml`])).toBe('<nfeProc>autorizada</nfeProc>');
  });

  it('só filtra pela LOJA da sessão — o cliente não escolhe de quem é o dado', async () => {
    const batch = vi.fn(async () => []);
    const res = new FakeRes();
    await controller(batch as any).xmlArchive(req, {} as any, res as any);
    expect(batch.mock.calls[0][0]).toBe(STORE);
  });

  it('falha do banco ANTES do cabeçalho sobe como erro — não vira .zip corrompido', async () => {
    const res = new FakeRes();
    const c = controller(vi.fn(async () => {
      throw new Error('connection refused');
    }) as any);

    await expect(c.xmlArchive(req, {} as any, res as any)).rejects.toThrow('connection refused');
    expect(res.headers).toEqual({});
    expect(res.chunks).toHaveLength(0);
  });

  it('falha NO MEIO derruba a conexão — encerrar limpo entregaria pacote incompleto', async () => {
    let chamada = 0;
    const res = new FakeRes();
    await controller(vi.fn(async () => {
      if (chamada++ === 0) return [nota()];
      throw new Error('conexão perdida');
    }) as any).xmlArchive(req, {} as any, res as any);

    expect(res.destroyed).toBe(true);
    expect(res.ended).toBe(false);
  });

  it('socket cheio: a montagem ESPERA o drain em vez de encher a memória', async () => {
    let chamada = 0;
    const res = new FakeRes();
    res.aceitarWrite = false;

    const promessa = controller(vi.fn(async () => (chamada++ === 0 ? [nota()] : [])) as any).xmlArchive(
      req,
      {} as any,
      res as any,
    );

    // Enquanto não há `drain`, o handler não termina.
    const terminou = await Promise.race([promessa.then(() => true), Promise.resolve(false)]);
    expect(terminou).toBe(false);

    res.aceitarWrite = true;
    while (res.listenerCount('drain') > 0) {
      res.emit('drain');
      await Promise.resolve();
    }
    await promessa;
    expect(res.ended).toBe(true);
  });
});
