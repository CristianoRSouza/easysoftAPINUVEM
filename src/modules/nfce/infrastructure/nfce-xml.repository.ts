import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import type { NfceXmlArchiveRow } from '../domain/nfce-xml-archive-entries';
import type { NfceXmlKind, NfceXmlRefRow } from '../domain/nfce-xml.rule';
import { filtrosDaLoja, type FiltrosDeNota } from './nfce-note-filter';

/**
 * Onde estão os XML das notas: a referência ao bucket (e o INI em coluna, para `generated`).
 * Só devolve ENDEREÇO lido com o filtro de loja — quem baixa é o `NfceXmlStorageClient`.
 */
@Injectable()
export class NfceXmlRepository {
  constructor(private readonly db: DbService) {}

  /** A referência do XML de UMA nota. Sem linha quando a nota não existe ou é de outra loja. */
  async findXmlRef(
    storeId: string,
    noteId: string,
    kind: NfceXmlKind,
  ): Promise<NfceXmlRefRow | undefined> {
    const { rows } = await this.db.query<NfceXmlRefRow>(
      `select n.number, n.serie, n.access_key,
              n.${kind}_xml                          as texto,
              ${kind === 'generated' ? 'null::text' : `n.storage_${kind}_xml_bucket`}  as bucket,
              ${kind === 'generated' ? 'null::text' : `n.storage_${kind}_xml_path`}    as path,
              ${kind === 'generated' ? 'null::int' : `n.storage_${kind}_xml_bytes`}    as bytes
         from public.vw_nfce_notes n
        where n.id = $1::uuid and n.store_id = $2::uuid`,
      [noteId, storeId],
    );
    return rows[0];
  }

  /**
   * Um lote de notas COM os XML, para o download em ZIP.
   *
   * Paginação por chave (`n.id > último`), não por `offset`: a exportação de um mês pode
   * levar minutos e, com `offset`, uma nota emitida durante o download desloca todas as
   * páginas seguintes — o pacote sairia com nota repetida e nota faltando, sem erro
   * nenhum. Por `id` a varredura é estável mesmo com o PDV emitindo ao mesmo tempo.
   *
   * A ordem aqui é por `id`, não por data: dentro do ZIP quem ordena é o nome do arquivo
   * (a chave de acesso), então trocar a ordem da varredura pela mais barata e estável não
   * muda nada para quem abre o pacote.
   */
  async findArchiveBatch(
    storeId: string,
    q: FiltrosDeNota,
    afterId: string | null,
    limit: number,
  ): Promise<NfceXmlArchiveRow[]> {
    const { where, params, add } = filtrosDaLoja(storeId, q);
    if (afterId) where.push(`n.id > ${add(afterId)}::uuid`);

    const { rows } = await this.db.query<NfceXmlArchiveRow>(
      `select n.id, n.number, n.serie, n.access_key, n.status, n.issued_at,
              n.generated_xml,
              n.storage_authorized_xml_bucket, n.storage_authorized_xml_path,
              n.storage_authorized_xml_bytes,
              n.storage_cancellation_xml_bucket, n.storage_cancellation_xml_path,
              n.storage_cancellation_xml_bytes,
              n.storage_signed_xml_bucket, n.storage_signed_xml_path,
              n.storage_signed_xml_bytes
         from public.vw_nfce_notes n
        where ${where.join(' and ')}
        order by n.id
        limit ${add(limit)}`,
      params,
    );
    return rows;
  }
}
