import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequireStore } from '../../../common/decorators';
import { StoreId } from '../../../common/http/request.decorators';
import type { TenantRequest } from '../../../common/http/tenant-request';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiSessionAuth } from '../../../common/swagger';
import {
  nfceXmlArchiveQuerySchema,
  type NfceXmlArchiveQuery,
} from '../../../contract/nfce.schema';
import { NfceService } from '../application/nfce.service';
import { montarArquivoZipDeXml } from '../domain/nfce-xml-archive';
import { descreverFiltros, nomeDoArquivoZip } from '../domain/nfce-xml-archive-description';
import { NFCE_XML_KINDS, isNfceXmlKind } from '../domain/nfce-xml.rule';
import { DocXmlArchive, DocXmlDaNota } from './nfce-xml.docs';
import { validNote } from './note-id.param';

/**
 * Notas lidas por ida ao banco durante o download.
 *
 * É o tamanho do LOTE, não um teto: a varredura continua enquanto houver nota casando
 * com o filtro. Ele existe só para a memória do processo ficar presa ao lote, e não ao
 * tamanho do período exportado.
 */
const LOTE_XML = 200;

/**
 * NFC-e — os XML: o pacote em ZIP do contador e o XML de uma nota, sob demanda.
 * Mesma tag, mesma autenticação e mesmo prefixo de `NfceController`; separado porque o
 * download é streaming e fala direto com a resposta do Express.
 */
@ApiTags('NFC-e')
@ApiSessionAuth()
@Controller('nfce')
export class NfceXmlController {
  // Contexto do log mantido como era antes da divisão do controller: quem filtra o log
  // de download por `NfceController` continua achando estas linhas.
  private readonly log = new Logger('NfceController');

  constructor(private readonly service: NfceService) {}

  @Get('xml-archive')
  @RequireStore()
  @DocXmlArchive()
  async xmlArchive(
    // `@Req()` (e não `@StoreId()`) porque o handler é streaming e já fala com a
    // requisição/resposta crua; a loja é a que o TenantGuard deixou escrita nela.
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(nfceXmlArchiveQuerySchema)) query: NfceXmlArchiveQuery,
    @Res() res: Response,
  ) {
    const storeId = req.storeId as string;
    const agora = new Date();

    // A PRIMEIRA leitura acontece ANTES de qualquer byte de resposta. Depois que o
    // cabeçalho sai não há como voltar atrás e responder um erro JSON — o navegador já
    // está gravando um arquivo. Falha de banco aqui vira 500 de verdade.
    const primeiroLote = await this.service.xmlArchiveBatch(storeId, query, null, LOTE_XML);
    let primeiroEntregue = false;

    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeDoArquivoZip(query, agora)}"`);
    res.setHeader('Cache-Control', 'no-store');

    // Cliente que fecha a aba no meio: sem isto, a montagem seguiria varrendo o banco
    // (e o `drain` que ela espera nunca chegaria) até o processo perceber sozinho.
    let abortado = false;
    res.on('close', () => {
      if (!res.writableEnded) abortado = true;
    });

    try {
      const stats = await montarArquivoZipDeXml({
        agora,
        cabecalhoResumo: descreverFiltros(query),
        abortado: () => abortado,
        buscarLote: async (depoisDoId) => {
          if (depoisDoId === null && !primeiroEntregue) {
            primeiroEntregue = true;
            return primeiroLote;
          }
          return this.service.xmlArchiveBatch(storeId, query, depoisDoId, LOTE_XML);
        },
        escrever: (chunk) => escreverComVazao(res, chunk),
        // D7: a nota migrada traz o ENDEREÇO, não o XML. Quem sabe baixar é o service —
        // e ele só é chamado com o caminho que a leitura filtrada por loja devolveu.
        baixarDoStorage: ({ bucket, path }) => this.service.baixarXmlDoStorage(bucket, path),
      });
      res.end();
      this.log.log(
        `xml-archive loja=${storeId} notas=${stats.notas} arquivos=${stats.arquivos}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error(`xml-archive loja=${storeId} falhou: ${msg}`);
      // O cabeçalho já foi enviado, então não existe "trocar por um 500". Derrubar a
      // conexão é o que faz o navegador tratar como download FALHO; encerrar normalmente
      // entregaria um ZIP incompleto com cara de sucesso.
      if (!res.writableEnded) res.destroy();
    }
  }

  @Get('notes/:noteId/xml/:kind')
  @RequireStore()
  @DocXmlDaNota()
  async xmlDaNota(
    @StoreId() storeId: string,
    @Param('noteId') noteId: string,
    @Param('kind') kind: string,
  ) {
    if (!isNfceXmlKind(kind)) {
      throw new BadRequestException(`kind inválido: use ${NFCE_XML_KINDS.join(', ')}.`);
    }
    const achado = await this.service.xmlDaNota(storeId, validNote(noteId), kind);
    if (!achado) throw new NotFoundException('XML não encontrado para esta nota.');
    // Envelope `{ data }` como todas as outras rotas: o cliente da tela só sabe ler JSON,
    // e inventar um caminho de texto puro só para esta rota criaria uma exceção no
    // contrato para servir uma comodidade que ninguém pediu.
    return { data: achado };
  }
}

/**
 * Escreve um pedaço do ZIP respeitando a vazão do socket.
 *
 * Sem o `drain`, um cliente lento (ou uma rede de loja) faria o Node acumular o ZIP
 * inteiro na fila do socket — a memória que o streaming existe para não gastar. O
 * `close` no meio da espera vira erro em vez de travar a montagem para sempre.
 */
function escreverComVazao(res: Response, chunk: Uint8Array): void | Promise<void> {
  if (res.destroyed || res.writableEnded) throw new Error('download_abortado');
  // Cópia: o fflate reaproveita os buffers que entrega no callback.
  if (res.write(Buffer.from(chunk))) return;
  return new Promise<void>((resolve, reject) => {
    const aoFechar = () => {
      res.off('drain', aoDrenar);
      reject(new Error('download_abortado'));
    };
    const aoDrenar = () => {
      res.off('close', aoFechar);
      resolve();
    };
    res.once('drain', aoDrenar);
    res.once('close', aoFechar);
  });
}
