import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StorageService } from '../src/modules/storage/application/storage.service';
import {
  DataDeEmissaoInvalidaError,
  caminhoDoXmlDaNota,
} from '../src/modules/storage/domain/fiscal-xml-path';
import {
  MAX_FISCAL_XML_BYTES,
  MAX_IMAGE_BYTES,
  MAX_PFX_BYTES,
  caminhoDaImagemDoProduto,
  caminhoDoPfx,
  ehConflitoNoStorage,
  imageContentType,
} from '../src/modules/storage/domain/upload.rule';
import { StorageBucketClient } from '../src/modules/storage/infrastructure/storage-bucket.client';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const PRODUCT = '22222222-2222-2222-2222-222222222222';
const CERT = '33333333-3333-3333-3333-333333333333';
const STORE = '44444444-4444-4444-4444-444444444444';

/**
 * Regras de upload que saíram de dentro do `StorageService`: tetos, contentType, caminho de
 * imagem/PFX e o que conta como conflito no Storage.
 */
describe('upload.rule', () => {
  it('tetos: 20 MB imagem, 5 MB PFX, 10 MB XML fiscal', () => {
    expect(MAX_IMAGE_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_PFX_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_FISCAL_XML_BYTES).toBe(10 * 1024 * 1024);
  });

  it('contentType por extensão, com image/jpeg como default', () => {
    expect(imageContentType('.png')).toBe('image/png');
    expect(imageContentType('.webp')).toBe('image/webp');
    expect(imageContentType('.gif')).toBe('image/gif');
    expect(imageContentType('.jpg')).toBe('image/jpeg');
    expect(imageContentType('.qualquer')).toBe('image/jpeg');
  });

  it('caminhos de imagem e PFX: os mesmos do SDK que rodava na loja', () => {
    expect(caminhoDaImagemDoProduto({ companyId: COMPANY, productId: PRODUCT, ext: '.png' })).toBe(
      `${COMPANY}/${PRODUCT}.png`,
    );
    expect(caminhoDoPfx({ companyId: COMPANY, certificateId: CERT })).toBe(`${COMPANY}/${CERT}.pfx`);
  });

  it('conflito: as três formas que o Storage usa, sem diferenciar caixa', () => {
    expect(ehConflitoNoStorage('The resource already exists')).toBe(true);
    expect(ehConflitoNoStorage('Duplicate')).toBe(true);
    expect(ehConflitoNoStorage('RESOURCE ALREADY there')).toBe(true);
    expect(ehConflitoNoStorage('bucket not found')).toBe(false);
  });
});

/**
 * A data de emissão fora do formato é erro de DOMÍNIO; quem o transforma no 400 que a rota
 * sempre devolveu é o service. O zod barra antes na rota real — isto é a segunda tranca.
 */
describe('data de emissão inválida: domínio acusa, service traduz', () => {
  it('o domínio lança o erro próprio, sem depender de HTTP', () => {
    expect(() =>
      caminhoDoXmlDaNota({
        companyId: COMPANY,
        storeId: STORE,
        model: '65',
        issuedAt: '31/07/2026',
        nota: {},
        kind: 'authorized',
      }),
    ).toThrow(DataDeEmissaoInvalidaError);
  });

  it('o service devolve 400 com a MESMA mensagem, e não toca o Storage', async () => {
    const upload = vi.fn();
    const supabase = { client: { storage: { from: vi.fn().mockReturnValue({ upload }) } } } as any;
    const serviceRole = { run: vi.fn((_: string, fn: () => unknown) => fn()) } as any;
    const service = new StorageService(new StorageBucketClient(supabase, serviceRole), {
      STORAGE_PRODUCT_IMAGES_BUCKET: 'a',
      STORAGE_NFCE_CERTIFICATES_BUCKET: 'b',
      STORAGE_FISCAL_XML_BUCKET: 'c',
    } as any);

    const tentativa = service.uploadFiscalXml(
      {
        documento: 'nota',
        companyId: COMPANY,
        storeId: STORE,
        model: '65',
        issuedAt: '31/07/2026',
        kind: 'authorized',
      },
      Buffer.from('<NFe/>'),
    );
    await expect(tentativa).rejects.toBeInstanceOf(BadRequestException);
    await expect(tentativa).rejects.toThrow(/Data de emissão inválida para o caminho do XML: "31\/07\/2026"/);
    expect(upload).not.toHaveBeenCalled();
  });
});
