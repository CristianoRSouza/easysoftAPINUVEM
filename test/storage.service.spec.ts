import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StorageService } from '../src/modules/storage/application/storage.service';
import { StorageBucketClient } from '../src/modules/storage/infrastructure/storage-bucket.client';

/**
 * Storage (Fase 2): upload de imagem/PFX pela API. Verifica paths/limites/contentType
 * idênticos ao SDK antigo do Sync-PG-SB e o roteamento pelo chokepoint 'storage'.
 */

const IMAGES_BUCKET = 'product-images';
const CERTS_BUCKET = 'store-certificates';
const FISCAL_BUCKET = 'fiscal-xml';
const COMPANY = '11111111-1111-1111-1111-111111111111';
const PRODUCT = '22222222-2222-2222-2222-222222222222';
const CERT = '33333333-3333-3333-3333-333333333333';
const STORE = '44444444-4444-4444-4444-444444444444';
const CHAVE = '35260712345678000199650010000011641000011648';

function build(uploadResult: { error: { message: string } | null } = { error: null }) {
  const upload = vi.fn().mockResolvedValue(uploadResult);
  const getPublicUrl = vi.fn().mockReturnValue({
    data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/x` },
  });
  const from = vi.fn().mockReturnValue({ upload, getPublicUrl });
  const supabase = { client: { storage: { from } } } as any;
  const runReasons: string[] = [];
  const serviceRole = {
    run: vi.fn((reason: string, fn: () => Promise<unknown>) => {
      runReasons.push(reason);
      return fn();
    }),
  } as any;
  const env = {
    STORAGE_PRODUCT_IMAGES_BUCKET: IMAGES_BUCKET,
    STORAGE_NFCE_CERTIFICATES_BUCKET: CERTS_BUCKET,
    STORAGE_FISCAL_XML_BUCKET: FISCAL_BUCKET,
  } as any;
  const service = new StorageService(new StorageBucketClient(supabase, serviceRole), env);
  return { service, upload, getPublicUrl, from, runReasons };
}

describe('StorageService', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('imagem: path `${company}/${product}${ext}`, contentType por ext, upsert, e pelo chokepoint storage', async () => {
    const res = await ctx.service.uploadProductImage(
      { companyId: COMPANY, productId: PRODUCT, ext: '.png' },
      Buffer.from('img'),
    );
    expect(ctx.from).toHaveBeenCalledWith(IMAGES_BUCKET);
    expect(ctx.upload).toHaveBeenCalledWith(
      `${COMPANY}/${PRODUCT}.png`,
      expect.any(Buffer),
      { upsert: true, contentType: 'image/png' },
    );
    expect(ctx.runReasons).toEqual(['storage']);
    expect(res.publicUrl).toContain('/storage/');
  });

  it('imagem: .jpg -> image/jpeg (default)', async () => {
    await ctx.service.uploadProductImage(
      { companyId: COMPANY, productId: PRODUCT, ext: '.jpg' },
      Buffer.from('x'),
    );
    expect(ctx.upload).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer),
      { upsert: true, contentType: 'image/jpeg' },
    );
  });

  it('imagem: acima de 20MB é rejeitada (400) antes de tocar o Storage', async () => {
    const big = Buffer.alloc(20 * 1024 * 1024 + 1);
    await expect(
      ctx.service.uploadProductImage({ companyId: COMPANY, productId: PRODUCT, ext: '.jpg' }, big),
    ).rejects.toThrow(/grande demais/);
    expect(ctx.upload).not.toHaveBeenCalled();
  });

  it('PFX: path `${company}/${cert}.pfx`, contentType x-pkcs12, devolve objectPath', async () => {
    const res = await ctx.service.uploadNfcePfx(
      { companyId: COMPANY, certificateId: CERT },
      Buffer.from('pfx'),
    );
    expect(ctx.from).toHaveBeenCalledWith(CERTS_BUCKET);
    expect(ctx.upload).toHaveBeenCalledWith(
      `${COMPANY}/${CERT}.pfx`,
      expect.any(Buffer),
      { upsert: true, contentType: 'application/x-pkcs12' },
    );
    expect(res.objectPath).toBe(`${COMPANY}/${CERT}.pfx`);
  });

  it('PFX: acima de 5MB é rejeitado (400)', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    await expect(
      ctx.service.uploadNfcePfx({ companyId: COMPANY, certificateId: CERT }, big),
    ).rejects.toThrow(/grande demais/);
    expect(ctx.upload).not.toHaveBeenCalled();
  });

  it('erro do Storage vira 400 com bucket/object na mensagem', async () => {
    const c = build({ error: { message: 'bucket not found' } });
    await expect(
      c.service.uploadProductImage({ companyId: COMPANY, productId: PRODUCT, ext: '.jpg' }, Buffer.from('x')),
    ).rejects.toThrow(/Storage recusou o upload.*bucket not found/);
  });

  /**
   * XML fiscal (D7). O que muda em relação às outras duas rotas: NÃO é upsert, conflito é
   * sucesso, e o sha256 sai daqui — não de quem chama.
   */
  describe('uploadFiscalXml', () => {
    const NOTA = {
      documento: 'nota' as const,
      companyId: COMPANY,
      storeId: STORE,
      model: '65' as const,
      issuedAt: '2026-07-31T18:21:00-03:00',
      accessKey: CHAVE,
      kind: 'authorized' as const,
    };

    it('sobe no bucket fiscal, sem upsert, com contentType xml, pelo chokepoint storage', async () => {
      const res = await ctx.service.uploadFiscalXml(NOTA, Buffer.from('<NFe/>'));
      expect(ctx.from).toHaveBeenCalledWith(FISCAL_BUCKET);
      expect(ctx.upload).toHaveBeenCalledWith(
        `${COMPANY}/${STORE}/65/2026/07/${CHAVE}/authorized.xml`,
        expect.any(Buffer),
        { upsert: false, contentType: 'application/xml' },
      );
      expect(ctx.runReasons).toEqual(['storage']);
      expect(res.objectPath).toContain(CHAVE);
      // O bucket volta na resposta: a linha do banco tem uma coluna `..._bucket` e o worker
      // não deve escrevê-la de memória.
      expect(res.bucket).toBe(FISCAL_BUCKET);
    });

    it('devolve sha256 do conteúdo e o tamanho em bytes', async () => {
      const res = await ctx.service.uploadFiscalXml(NOTA, Buffer.from('<NFe/>'));
      // sha256 de '<NFe/>' — fixo de propósito: se alguém passar a hashear outra coisa
      // (o path, o buffer já codificado), a linha do banco deixa de provar o objeto.
      expect(res.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(res.bytes).toBe(6);
    });

    /**
     * O apply da fila reprocessa o mesmo evento a cada retry. Como o caminho é derivado do
     * documento, reencontrar o objeto é o caso NORMAL — e tratá-lo como erro faria a fila
     * parar em cima de notas que já estão salvas.
     */
    it('conflito de objeto já existente é SUCESSO, não erro', async () => {
      const c = build({ error: { message: 'The resource already exists' } });
      const res = await c.service.uploadFiscalXml(NOTA, Buffer.from('<NFe/>'));
      expect(res.objectPath).toContain(CHAVE);
      expect(res.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('erro real do Storage continua virando 400', async () => {
      const c = build({ error: { message: 'bucket not found' } });
      await expect(c.service.uploadFiscalXml(NOTA, Buffer.from('<NFe/>'))).rejects.toThrow(
        /Storage recusou o upload.*bucket not found/,
      );
    });

    it('acima de 10MB (o teto do bucket) é rejeitado antes de tocar o Storage', async () => {
      const big = Buffer.alloc(10 * 1024 * 1024 + 1);
      await expect(ctx.service.uploadFiscalXml(NOTA, big)).rejects.toThrow(/grande demais/);
      expect(ctx.upload).not.toHaveBeenCalled();
    });

    it('inutilização vai para fora da árvore de chave, com prefixo de tenant', async () => {
      const res = await ctx.service.uploadFiscalXml(
        {
          documento: 'inutilizacao',
          companyId: COMPANY,
          storeId: STORE,
          model: '65',
          year: 2026,
          serie: 2,
          numberStart: 1160,
          numberEnd: 1163,
        },
        Buffer.from('<inutNFe/>'),
      );
      expect(res.objectPath).toBe(
        `${COMPANY}/${STORE}/65/2026/inutilizations/002-000001160-000001163.xml`,
      );
    });

    it('evento vai para a pasta da nota', async () => {
      const res = await ctx.service.uploadFiscalXml(
        {
          documento: 'evento',
          companyId: COMPANY,
          storeId: STORE,
          model: '65',
          noteIssuedAt: '2026-07-31T18:21:00-03:00',
          accessKey: CHAVE,
          eventType: '110111',
          eventSequence: 1,
          kind: 'request',
        },
        Buffer.from('<evento/>'),
      );
      expect(res.objectPath).toBe(`${COMPANY}/${STORE}/65/2026/07/${CHAVE}/event-110111-001.xml`);
    });
  });
});
