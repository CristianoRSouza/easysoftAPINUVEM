import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { ENV, type Env } from '../../../config/env';
import {
  DataDeEmissaoInvalidaError,
  caminhoDoXmlDaInutilizacao,
  caminhoDoXmlDaNota,
  caminhoDoXmlDoEvento,
} from '../domain/fiscal-xml-path';
import {
  MAX_FISCAL_XML_BYTES,
  MAX_IMAGE_BYTES,
  MAX_PFX_BYTES,
  caminhoDaImagemDoProduto,
  caminhoDoPfx,
  ehConflitoNoStorage,
  imageContentType,
} from '../domain/upload.rule';
import type { FiscalXmlMeta, NfceCertificateMeta, ProductImageMeta } from '../dto/storage.schema';
import { StorageBucketClient } from '../infrastructure/storage-bucket.client';

/**
 * Upload ao Storage do Supabase (Fase 2 do cutover Sync-PG-SB). Substitui o SDK que rodava
 * NAS LOJAS: o worker agora manda o buffer por HTTPS e a API faz o upload com a service_role
 * (via chokepoint 'storage'). O trabalho LOCAL (achar arquivo, baixar da LAN, ler bytes)
 * continua na loja — só o upload sobe pra cá. Paths/limites idênticos aos do SDK antigo.
 */
@Injectable()
export class StorageService {
  private readonly imagesBucket: string;
  private readonly certificatesBucket: string;
  private readonly fiscalXmlBucket: string;

  constructor(
    private readonly storage: StorageBucketClient,
    @Inject(ENV) env: Env,
  ) {
    this.imagesBucket = env.STORAGE_PRODUCT_IMAGES_BUCKET;
    this.certificatesBucket = env.STORAGE_NFCE_CERTIFICATES_BUCKET;
    this.fiscalXmlBucket = env.STORAGE_FISCAL_XML_BUCKET;
  }

  /** Sobe a imagem e devolve a URL pública (mesmo path `${companyId}/${productId}${ext}`). */
  async uploadProductImage(meta: ProductImageMeta, buffer: Buffer): Promise<{ publicUrl: string }> {
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException(`Imagem grande demais (máx ${MAX_IMAGE_BYTES} bytes).`);
    }
    const objectPath = caminhoDaImagemDoProduto(meta);
    await this.upload(this.imagesBucket, objectPath, buffer, imageContentType(meta.ext));
    return { publicUrl: this.storage.publicUrl(this.imagesBucket, objectPath) };
  }

  /** Sobe o PFX e devolve o object path (mesmo `${companyId}/${certificateId}.pfx`). */
  async uploadNfcePfx(
    meta: NfceCertificateMeta,
    buffer: Buffer,
  ): Promise<{ objectPath: string }> {
    if (buffer.length > MAX_PFX_BYTES) {
      throw new BadRequestException(`PFX grande demais (máx ${MAX_PFX_BYTES} bytes).`);
    }
    const objectPath = caminhoDoPfx(meta);
    await this.upload(this.certificatesBucket, objectPath, buffer, 'application/x-pkcs12');
    return { objectPath };
  }

  /**
   * Sobe um XML fiscal ao acervo e devolve a referência que vai para a linha do banco.
   *
   * ── DUAS DIFERENÇAS PARA AS OUTRAS DUAS ROTAS, E AS DUAS SÃO DE PROPÓSITO ────
   *
   * 1. **`upsert: false`.** Imagem e PFX são substituíveis — o produto trocou de foto, o
   *    certificado venceu. Documento fiscal não: o caminho é derivado da chave de acesso,
   *    então o mesmo documento sempre cai no mesmo lugar com o mesmo conteúdo. Conflito
   *    aqui significa "já subiu numa execução anterior", e é por isso que ele é tratado
   *    como SUCESSO: o apply da fila é reprocessado a cada retry, e um upsert deixaria o
   *    reprocessamento sobrescrever silenciosamente um XML autorizado por um payload mais
   *    novo — que é exatamente o que não pode acontecer com o que o contador escritura.
   *
   * 2. **O `sha256` é calculado AQUI**, sobre o buffer que realmente subiu, e não recebido
   *    de quem chama. Um hash que viaja junto com o arquivo prova apenas que quem mandou os
   *    dois é a mesma pessoa; o que ele precisa provar é que o objeto no bucket é o que a
   *    linha do banco diz que é.
   */
  async uploadFiscalXml(
    meta: FiscalXmlMeta,
    buffer: Buffer,
  ): Promise<{ bucket: string; objectPath: string; sha256: string; bytes: number }> {
    if (buffer.length > MAX_FISCAL_XML_BYTES) {
      throw new BadRequestException(`XML grande demais (máx ${MAX_FISCAL_XML_BYTES} bytes).`);
    }
    const objectPath = this.caminhoDoXml(meta);
    await this.upload(this.fiscalXmlBucket, objectPath, buffer, 'application/xml', {
      upsert: false,
      conflitoEhSucesso: true,
    });
    return {
      // O bucket volta na resposta porque a linha do banco tem uma coluna `..._bucket` para
      // preencher. Se o worker o escrevesse de memória, uma troca de bucket aqui deixaria o
      // banco apontando para um lugar onde o arquivo não está — e só o download acusaria.
      bucket: this.fiscalXmlBucket,
      objectPath,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      bytes: buffer.length,
    };
  }

  /**
   * Despacho dos três formatos de caminho. A união do DTO garante que não falta campo.
   *
   * A data de emissão fora do formato sai do domínio como erro próprio; aqui ela vira o 400
   * que a rota sempre devolveu, com a mesma mensagem.
   */
  private caminhoDoXml(meta: FiscalXmlMeta): string {
    try {
      return this.derivarCaminhoDoXml(meta);
    } catch (e) {
      if (e instanceof DataDeEmissaoInvalidaError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  private derivarCaminhoDoXml(meta: FiscalXmlMeta): string {
    const { companyId, storeId, model } = meta;
    if (meta.documento === 'inutilizacao') {
      return caminhoDoXmlDaInutilizacao({
        companyId,
        storeId,
        model,
        year: meta.year,
        serie: meta.serie,
        numberStart: meta.numberStart,
        numberEnd: meta.numberEnd,
      });
    }
    const nota = {
      accessKey: meta.accessKey,
      number: meta.number,
      serie: meta.serie,
      noteId: meta.noteId,
    };
    if (meta.documento === 'evento') {
      return caminhoDoXmlDoEvento({
        companyId,
        storeId,
        model,
        noteIssuedAt: meta.noteIssuedAt,
        nota,
        eventType: meta.eventType,
        eventSequence: meta.eventSequence,
        kind: meta.kind,
      });
    }
    return caminhoDoXmlDaNota({
      companyId,
      storeId,
      model,
      issuedAt: meta.issuedAt,
      nota,
      kind: meta.kind,
    });
  }

  /** Erro do Storage vira 400 (contrato de serviço). */
  private async upload(
    bucket: string,
    objectPath: string,
    buffer: Buffer,
    contentType: string,
    opts: { upsert: boolean; conflitoEhSucesso?: boolean } = { upsert: true },
  ): Promise<void> {
    const erro = await this.storage.upload(bucket, objectPath, buffer, {
      upsert: opts.upsert,
      contentType,
    });
    if (erro === null) return;
    // O objeto já estar lá não é falha quando o caminho é derivado do próprio documento.
    if (opts.conflitoEhSucesso && ehConflitoNoStorage(erro)) return;
    throw new BadRequestException(
      `Storage recusou o upload (bucket="${bucket}", object="${objectPath}"): ${erro}`,
    );
  }
}
