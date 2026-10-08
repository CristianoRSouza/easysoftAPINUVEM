import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { ServiceOnly } from '../../../common/decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiServiceKeyAuth } from '../../../common/swagger';
import { StorageService } from '../application/storage.service';
import {
  fiscalXmlMetaSchema,
  nfceCertificateMetaSchema,
  productImageMetaSchema,
  type FiscalXmlMeta,
  type NfceCertificateMeta,
  type ProductImageMeta,
} from '../dto/storage.schema';
import { DocUploadFiscalXml, DocUploadNfcePfx, DocUploadProductImage } from './storage.docs';

/** Backstop do multer (a checagem fina por tipo — 20MB imagem / 5MB PFX — é no service). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type UploadedMulterFile = { buffer: Buffer; size: number };

/** O multipart precisa trazer o campo `file` com conteúdo; sem ele é 400. */
function bufferDoArquivo(file: UploadedMulterFile | undefined): Buffer {
  if (!file?.buffer?.length) {
    throw new BadRequestException('Arquivo "file" ausente ou vazio.');
  }
  return file.buffer;
}

/**
 * Storage (Fase 2 do cutover Sync-PG-SB) — máquina-a-máquina (@ServiceOnly, X-Service-Key).
 * O worker das lojas manda o buffer por multipart e a API sobe ao bucket com a service_role,
 * aposentando o SDK Supabase (e a chave de Storage) das lojas.
 */
@ApiTags('Storage (máquina-a-máquina)')
@ApiServiceKeyAuth()
@Controller('storage')
export class StorageController {
  constructor(private readonly service: StorageService) {}

  @Post('product-images')
  @ServiceOnly()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @DocUploadProductImage()
  async uploadProductImage(
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Body(new ZodValidationPipe(productImageMetaSchema)) meta: ProductImageMeta,
  ): Promise<{ publicUrl: string }> {
    return this.service.uploadProductImage(meta, bufferDoArquivo(file));
  }

  @Post('nfce-certificates')
  @ServiceOnly()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @DocUploadNfcePfx()
  async uploadNfcePfx(
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Body(new ZodValidationPipe(nfceCertificateMetaSchema)) meta: NfceCertificateMeta,
  ): Promise<{ objectPath: string }> {
    return this.service.uploadNfcePfx(meta, bufferDoArquivo(file));
  }

  @Post('fiscal-xml')
  @ServiceOnly()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @DocUploadFiscalXml()
  async uploadFiscalXml(
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Body(new ZodValidationPipe(fiscalXmlMetaSchema)) meta: FiscalXmlMeta,
  ): Promise<{ bucket: string; objectPath: string; sha256: string; bytes: number }> {
    return this.service.uploadFiscalXml(meta, bufferDoArquivo(file));
  }
}
