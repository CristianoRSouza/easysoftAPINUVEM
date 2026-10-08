import { nullableNumber, nullableStr, str, toInt, toIso } from '../../../common/mapping/coerce';
import {
  NFCE_CARD_BRANDS,
  NFCE_PAYMENT_LABELS,
  type NfceAttentionCounts,
  type NfceEvent,
  type NfceLog,
  type NfcePayment,
  type NfceSummary,
  type NfceTotals,
} from '../../../contract/nfce.schema';
import type { Row } from '../../../db/queryable';
import { numStr } from './fiscal-value';

/**
 * Linha do banco → forma do fio, para as leituras de NFC-e. Funções puras: não consultam,
 * não lançam, não dependem do Nest. O detalhe e os itens (que normalizam por categoria de
 * campo) têm mapper próprio: `nfce-detail.mapper.ts` e `nfce-item.mapper.ts`.
 */

/** Os três contadores de atenção, como o banco os devolve (`count(*)` é int8 → string). */
export interface AttentionCountsRow {
  manual_review: string;
  reconcile_failed: string;
  unusable: string;
}

export function mapAttentionCounts(r: AttentionCountsRow | undefined): NfceAttentionCounts {
  return {
    manualReview: toInt(r?.manual_review),
    reconcileFailed: toInt(r?.reconcile_failed),
    unusable: toInt(r?.unusable),
  };
}

export function mapSummary(n: Row): NfceSummary {
  return {
    id: String(n.id),
    numero: toInt(n.number),
    serie: toInt(n.serie),
    chave_acesso: nullableStr(n.access_key),
    status: n.status != null ? String(n.status) : 'draft',
    valor_total: numStr(n.total_value),
    // A listagem nunca trouxe desconto; mantido para a tela não precisar de dois formatos.
    valor_desconto: '0',
    emissao_em: toIso(n.issued_at),
    autorizada_em: n.authorized_at ? toIso(n.authorized_at) : null,
    protocolo: nullableStr(n.authorization_protocol),
    codigo_retorno: nullableStr(n.sefaz_status_code),
    motivo_retorno: nullableStr(n.sefaz_status_reason),
    tipo_emissao: nullableNumber(n.emission_type),
    reconcile_status: nullableStr(n.reconcile_status),
    retry_count: nullableNumber(n.retry_count),
    // Campos que a listagem não carrega (a tela de detalhe é quem busca):
    order_id: null,
    qrcode: null,
    emitente_cnpj: '',
    emitente_razao: '',
    emitente_fantasia: null,
    emitente_uf: '',
    destinatario_cpf: nullableStr(n.destinatario_cpf),
    destinatario_nome: nullableStr(n.destinatario_nome),
    qtd_itens: toInt(n.qtd_itens),
    formas_pagamento: nullableStr(n.formas),
  };
}

/** Total da listagem: vem repetido em toda linha (`count(*) over()`); sem linha, é zero. */
export const totalDaListagem = (rows: Row[]): number =>
  rows.length > 0 ? toInt(rows[0].total_count) : 0;

/** Um grupo de `totals`: status (chave crua, minúscula), quantidade e soma do valor. */
export interface TotalsByStatusRow {
  status: string;
  qtd: string;
  valor: string;
}

export function somarTotais(rows: TotalsByStatusRow[]): NfceTotals {
  const porStatus: Record<string, number> = {};
  let total = 0;
  let valorAutorizado = '0';
  for (const r of rows) {
    const n = toInt(r.qtd);
    porStatus[r.status] = n;
    total += n;
    // Só `authorized` soma dinheiro: nota rejeitada tem valor no rascunho, mas não
    // houve venda autorizada nenhuma — misturar as duas infla o faturamento da tela.
    if (r.status === 'authorized') valorAutorizado = numStr(r.valor);
  }
  return { total, porStatus, valorAutorizado };
}

export function mapAcbrConfig(r: Row) {
  return {
    id: String(r.id),
    key: str(r.key),
    value: r.value == null ? '' : String(r.value),
    description: nullableStr(r.description),
    updated_at: r.updated_at == null ? null : toIso(r.updated_at),
  };
}

export function mapPayment(p: Row): NfcePayment {
  return {
    seq: toInt(p.payment_number),
    forma_pagamento: str(p.payment_method),
    forma_descricao: NFCE_PAYMENT_LABELS[str(p.payment_method)] ?? str(p.payment_method),
    valor: numStr(p.payment_value),
    troco: p.change_value != null ? numStr(p.change_value) : null,
    tipo_integracao: nullableNumber(p.integration_type),
    integracao_descricao:
      Number(p.integration_type) === 1
        ? 'TEF Integrado'
        : Number(p.integration_type) === 2
          ? 'POS / Não integrado'
          : null,
    bandeira_cartao: nullableStr(p.card_brand),
    bandeira_descricao: p.card_brand ? (NFCE_CARD_BRANDS[str(p.card_brand)] ?? null) : null,
    nsu_autorizacao: nullableStr(p.authorization_number),
    cnpj_credenciadora: nullableStr(p.acquirer_cnpj),
  };
}

export function mapLog(r: Row): NfceLog {
  return {
    id: String(r.id),
    created_at: toIso(r.created_at),
    type: nullableStr(r.type),
    level: str(r.level),
    message: str(r.message),
    // `details` é jsonb: serializamos aqui para o contrato ser sempre string|null.
    details:
      r.details == null ? null : typeof r.details === 'string' ? r.details : JSON.stringify(r.details),
    previous_status: nullableStr(r.previous_status),
    new_status: nullableStr(r.new_status),
    return_code: nullableStr(r.return_code),
    protocol: nullableStr(r.protocol),
    user_name: nullableStr(r.user_name),
  };
}

export function mapEvent(r: Row): NfceEvent {
  return {
    id: String(r.id),
    event_type: str(r.event_type),
    event_description: nullableStr(r.event_description),
    event_sequence: toInt(r.event_sequence),
    event_at: toIso(r.event_at),
    justification: nullableStr(r.justification),
    correction: nullableStr(r.correction),
    protocol: nullableStr(r.protocol),
    sefaz_status_code: nullableStr(r.sefaz_status_code),
    sefaz_status_reason: nullableStr(r.sefaz_status_reason),
    registered_at: r.registered_at ? toIso(r.registered_at) : null,
    situation: nullableStr(r.situation),
    created_at: toIso(r.created_at),
  };
}
