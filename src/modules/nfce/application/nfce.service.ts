import { Injectable } from '@nestjs/common';
import type {
  NfceAttentionCounts,
  NfceEvent,
  NfceListQuery,
  NfceListResult,
  NfceLog,
  NfcePayment,
  NfceTotals,
  NfceTotalsQuery,
  NfceXmlArchiveQuery,
} from '../../../contract/nfce.schema';
import { mapIssuerConfig } from '../domain/issuer-config.mapper';
import { mapDetail } from '../domain/nfce-detail.mapper';
import { mapItem } from '../domain/nfce-item.mapper';
import type { NfceXmlArchiveRow } from '../domain/nfce-xml-archive-entries';
import { excedeTetoInline, nomeDoArquivoXml, type NfceXmlKind } from '../domain/nfce-xml.rule';
import {
  mapAcbrConfig,
  mapAttentionCounts,
  mapEvent,
  mapLog,
  mapPayment,
  mapSummary,
  somarTotais,
  totalDaListagem,
} from '../domain/nfce.mapper';
import { NfceXmlStorageClient } from '../infrastructure/nfce-xml-storage.client';
import { NfceXmlRepository } from '../infrastructure/nfce-xml.repository';
import { NfceRepository } from '../infrastructure/nfce.repository';

/**
 * NFC-e (leitura): a nota, as filhas e a configuração fiscal da loja.
 *
 * Cada método é um caso de uso: busca no repositório e entrega na forma do fio. O SQL (e a
 * amarra nota↔loja que substitui a RLS) está em `NfceRepository`; o que cada campo vira,
 * nos mappers de `domain/`.
 *
 * Para os XML, a ordem que este service garante é a que protege o acervo: primeiro a linha
 * lida com o filtro de loja (`NfceXmlRepository`), depois o download do caminho QUE AQUELA
 * LEITURA devolveu (`NfceXmlStorageClient`).
 */
@Injectable()
export class NfceService {
  constructor(
    private readonly repository: NfceRepository,
    private readonly xmlRepository: NfceXmlRepository,
    private readonly xmlStorage: NfceXmlStorageClient,
  ) {}

  /** Baixa um XML do acervo. NÃO autoriza nada — ver `NfceXmlStorageClient.baixar`. */
  async baixarXmlDoStorage(bucket: string, path: string): Promise<string> {
    return this.xmlStorage.baixar(bucket, path);
  }

  /**
   * O XML de UMA nota, para a aba de detalhe (F3.3).
   *
   * Existe porque o detalhe parou de carregar o XML junto com as ~110 colunas: ele viajava em
   * toda abertura de nota, mesmo de quem nunca clica na aba. Aqui ele é buscado sob demanda.
   *
   * Devolve `null` para nota de outra loja E para nota sem aquele XML — de propósito: são,
   * do lado de fora, a mesma coisa (404). Distinguir as duas confirmaria a existência de uma
   * nota alheia para quem tentasse adivinhar `noteId`.
   */
  async xmlDaNota(
    storeId: string,
    noteId: string,
    kind: NfceXmlKind,
  ): Promise<{ xml: string; nomeArquivo: string } | null> {
    const r = await this.xmlRepository.findXmlRef(storeId, noteId, kind);
    if (!r) return null;

    // Teto do que é servido inline. NFC-e tem alguns kB; o que passa disso é o pacote em ZIP.
    if (excedeTetoInline(r.bytes)) {
      throw new Error(`xml_grande_demais: ${r.bytes} bytes — use o download em ZIP.`);
    }

    /**
     * ⟨Fase 5⟩ Sem fallback para a coluna: ela foi esvaziada em 16/09/2026. `generated` é a
     * exceção — é INI do ACBr, nunca foi ao bucket, e só existe em coluna ⟨D-1⟩.
     */
    let xml: string | null = null;
    if (r.path && r.bucket) xml = await this.baixarXmlDoStorage(String(r.bucket), String(r.path));
    else if (kind === 'generated' && r.texto) xml = String(r.texto);
    if (!xml) return null;

    return { xml, nomeArquivo: nomeDoArquivoXml(r, kind) };
  }

  /** Um lote de notas com as referências de XML — ver `NfceXmlRepository.findArchiveBatch`. */
  async xmlArchiveBatch(
    storeId: string,
    q: NfceXmlArchiveQuery,
    afterId: string | null,
    limit: number,
  ): Promise<NfceXmlArchiveRow[]> {
    return this.xmlRepository.findArchiveBatch(storeId, q, afterId, limit);
  }

  async attentionCounts(storeId: string): Promise<NfceAttentionCounts> {
    return mapAttentionCounts(await this.repository.countAttention(storeId));
  }

  async list(storeId: string, q: NfceListQuery): Promise<NfceListResult> {
    const offset = (q.page - 1) * q.limit;
    const rows = await this.repository.findNotes(storeId, q, q.limit, offset);
    return {
      data: rows.map(mapSummary),
      total: totalDaListagem(rows),
      page: q.page,
      limit: q.limit,
    };
  }

  /**
   * Totais dos cards do topo — do PERÍODO inteiro.
   *
   * ⚠️ Isto existe porque a tela somava as linhas CARREGADAS: com 1.164 notas no filtro e
   * 50 por página, o card "Autorizadas" mostrava 50 e o "Valor autorizado" somava só
   * essas 50. Não era um arredondamento — era a página inteira faltando, e sem nenhum
   * sinal de que faltava. Card de resumo com número errado é pior que card ausente: o
   * usuário confere o faturamento por ele.
   */
  async totals(storeId: string, q: NfceTotalsQuery): Promise<NfceTotals> {
    return somarTotais(await this.repository.sumTotalsByStatus(storeId, q));
  }

  /**
   * Detalhe da nota. Devolve `null` quando a nota não existe **ou** é de outra loja — ver
   * `NfceRepository.findDetail`.
   */
  async detail(storeId: string, noteId: string): Promise<Record<string, unknown> | null> {
    const row = await this.repository.findDetail(storeId, noteId);
    return row ? mapDetail(row) : null;
  }

  async items(storeId: string, noteId: string) {
    return (await this.repository.findItems(storeId, noteId)).map(mapItem);
  }

  /**
   * Configuração do emitente. Devolve uma LISTA de 0 ou 1 — é o formato que a tela já
   * consome (herança de quando a consulta era por empresa).
   *
   * `ehAdmin` decide se o CSC vai com valor (ver `issuer-config.sql.ts`). Vem do
   * `TenantGuard`, que já resolveu o papel contra o banco — não de nada que o cliente
   * mande.
   */
  async issuerConfig(companyId: string, storeId: string, ehAdmin: boolean) {
    const rows = await this.repository.findIssuerConfig(companyId, storeId, ehAdmin);
    if (rows.length === 0) return [];
    return [mapIssuerConfig(rows[0])];
  }

  async acbrConfig(companyId: string, storeId: string) {
    return (await this.repository.findAcbrConfig(companyId, storeId)).map(mapAcbrConfig);
  }

  async payments(storeId: string, noteId: string): Promise<NfcePayment[]> {
    return (await this.repository.findPayments(storeId, noteId)).map(mapPayment);
  }

  async logs(storeId: string, noteId: string): Promise<NfceLog[]> {
    return (await this.repository.findLogs(storeId, noteId)).map(mapLog);
  }

  async events(storeId: string, noteId: string): Promise<NfceEvent[]> {
    return (await this.repository.findEvents(storeId, noteId)).map(mapEvent);
  }
}
