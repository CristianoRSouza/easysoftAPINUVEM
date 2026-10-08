/**
 * SQL do detalhe da NFC-e — a nota e as 5 tabelas filhas numa consulta só.
 *
 * O browser faz seis chamadas paralelas ao Supabase e junta em JavaScript. Aqui são
 * cinco LEFT JOIN sobre `note_id`, e — o ponto principal — **o rename para o contrato
 * acontece no próprio SELECT**. São ~110 campos com nomes diferentes dos do banco
 * (`n.model` → `modelo`, `iss.cnpj` → `emitente_cnpj`); fazer isso num mapeador de
 * JavaScript seria 110 linhas onde um typo passa despercebido e some um campo da tela
 * fiscal. Com alias no SQL, coluna errada quebra a consulta na hora — o smoke contra o
 * schema real acusa antes de virar bug.
 *
 * LEFT JOIN, não INNER: nota sem destinatário (consumidor não identificado) é o caso
 * NORMAL numa NFC-e, não exceção. Com INNER, essas notas sumiriam.
 *
 * $1 = noteId, $2 = storeId. O filtro por loja está na nota, que é a raiz da junção.
 */
export const NFCE_DETAIL_SQL = `
select
  n.id,
  n.number                          as numero,
  n.serie                           as serie,
  n.model                           as modelo,
  n.access_key                      as chave_acesso,
  n.status                          as status,
  n.emission_type                   as tipo_emissao,
  n.emission_purpose                as finalidade,
  n.issued_at                       as emissao_em,
  n.authorized_at                   as autorizada_em,
  n.authorization_protocol          as protocolo,
  n.sefaz_status_code               as codigo_retorno,
  n.sefaz_status_reason             as motivo_retorno,
  n.qrcode                          as qrcode,
  n.query_url                       as url_consulta,
  -- ⟨F3.4⟩ O XML NAO vem mais aqui. Ele viajava junto com estas ~110 colunas em TODA
  -- abertura de nota, inclusive para quem nunca clica na aba XML — e uma nota tem ~8 kB de
  -- XML contra alguns bytes de cada campo. Agora a tela pergunta por ele em
  -- GET /nfce/notes/:id/xml/:kind , e so quando a aba e aberta.
  --
  -- As flags existem para a tela saber QUAIS abas oferecer sem precisar do conteudo. Cada
  -- uma olha a coluna text OU a referencia no bucket: durante a convivencia so uma das
  -- duas esta preenchida em boa parte das notas, e olhar so uma esconderia a aba.
  (n.authorized_xml is not null or n.storage_authorized_xml_path is not null)     as tem_xml_autorizado,
  (n.cancellation_xml is not null or n.storage_cancellation_xml_path is not null) as tem_xml_cancelamento,
  (n.signed_xml is not null or n.storage_signed_xml_path is not null)             as tem_xml_assinado,
  (n.generated_xml is not null)                                                   as tem_xml_gerado,
  n.cancellation_protocol           as cancellation_protocol,
  n.cancelled_at                    as cancelled_at,
  n.order_id                        as order_id,
  n.transaction_id                  as transaction_id,
  n.total_value                     as valor_total,
  n.discount_value                  as valor_desconto,
  n.total_value                     as total_nota,
  n.products_value                  as total_produtos,
  n.discount_value                  as total_desconto,
  n.freight_value                   as total_frete,
  n.insurance_value                 as total_seguro,
  n.other_expenses_value            as outras_despesas,
  n.icms_value                      as total_icms,
  n.icms_st_value                   as total_icms_st,
  n.ipi_value                       as total_ipi,
  n.pis_value                       as total_pis,
  n.cofins_value                    as total_cofins,
  n.fcp_value                       as total_fcp,
  n.icms_tot_v_tot_trib             as icms_tot_v_tot_trib,
  n.tot_v_nf_tot                    as tot_v_nf_tot,
  n.ibscbs_tot_v_bc                 as ibscbs_tot_v_bc,
  n.ibscbs_tot_v_ibs                as ibscbs_tot_v_ibs,
  n.ibscbs_tot_v_ibs_uf             as ibscbs_tot_v_ibs_uf,
  n.ibscbs_tot_v_dif_ibs_uf         as ibscbs_tot_v_dif_ibs_uf,
  n.ibscbs_tot_v_dev_trib_ibs_uf    as ibscbs_tot_v_dev_trib_ibs_uf,
  n.ibscbs_tot_v_ibs_mun            as ibscbs_tot_v_ibs_mun,
  n.ibscbs_tot_v_dif_ibs_mun        as ibscbs_tot_v_dif_ibs_mun,
  n.ibscbs_tot_v_dev_trib_ibs_mun   as ibscbs_tot_v_dev_trib_ibs_mun,
  n.ibscbs_tot_v_cbs                as ibscbs_tot_v_cbs,
  n.ibscbs_tot_v_dif_cbs            as ibscbs_tot_v_dif_cbs,
  n.ibscbs_tot_v_dev_trib_cbs       as ibscbs_tot_v_dev_trib_cbs,
  n.origin_note_id                  as origin_note_id,
  n.replacement_note_id             as replacement_note_id,
  n.emission_path                   as emission_path,
  n.reconcile_status                as reconcile_status,
  n.retry_count                     as retry_count,
  n.last_retry_at                   as last_retry_at,
  n.next_retry_at                   as next_retry_at,
  n.last_error_code                 as last_error_code,
  n.last_error_message              as last_error_message,
  n.manual_fix_required_at          as manual_fix_required_at,
  n.manual_fix_note                 as manual_fix_note,

  idt.operation_nature              as natureza_operacao,
  idt.environment_type              as ambiente,
  idt.final_consumer_indicator      as consumidor_final,
  idt.presence_indicator            as indicador_presenca,
  idt.intermediary_indicator        as intermediary_indicator,
  idt.emission_process              as processo_emissao,
  idt.process_version               as versao_processo,

  iss.cnpj                          as emitente_cnpj,
  iss.company_name                  as emitente_razao,
  iss.trade_name                    as emitente_fantasia,
  iss.state_registration            as emitente_ie,
  iss.municipal_registration        as emitente_im,
  iss.cnae                          as emitente_cnae,
  iss.tax_regime_code               as emitente_crt,
  iss.street                        as emitente_logradouro,
  iss.number                        as emitente_numero,
  iss.complement                    as emitente_complemento,
  iss.neighborhood                  as emitente_bairro,
  iss.municipality_name             as emitente_municipio,
  iss.uf                            as emitente_uf,
  iss.zip_code                      as emitente_cep,
  iss.phone                         as emitente_fone,

  rec.cpf                           as destinatario_cpf,
  rec.cnpj                          as destinatario_cnpj,
  rec.name                          as destinatario_nome,
  rec.email                         as destinatario_email,
  rec.street                        as destinatario_logradouro,
  rec.number                        as destinatario_numero,
  rec.complement                    as destinatario_complemento,
  rec.neighborhood                  as destinatario_bairro,
  rec.municipality_name             as destinatario_municipio,
  rec.uf                            as destinatario_uf,
  rec.zip_code                      as destinatario_cep,
  rec.phone                         as destinatario_fone,
  rec.ie_indicator                  as destinatario_ie_indicador,

  add_info.tax_info                 as info_fiscal,
  add_info.additional_info          as info_complementar,

  pg.formas                         as formas_pagamento
from public.vw_nfce_notes n
left join public.vw_nfce_identification  idt      on idt.note_id      = n.id
left join public.vw_nfce_issuer          iss      on iss.note_id      = n.id
left join public.vw_nfce_recipient       rec      on rec.note_id      = n.id
left join public.vw_nfce_additional_info add_info on add_info.note_id = n.id
left join lateral (
  select string_agg(distinct payment_method, ', ' order by payment_method) as formas
    from public.vw_nfce_payments where note_id = n.id
) pg on true
where n.id = $1::uuid and n.store_id = $2::uuid
limit 1`;
