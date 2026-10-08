/**
 * Itens da NFC-e com os impostos — uma consulta.
 *
 * ⚠️ TERCEIRO caso do padrão "filtra só pelo id e confia na RLS" (achado na varredura de
 * 2026-07-30, junto com pagamentos/logs/eventos e a auditoria de agente). No browser,
 * `fetchCloudNfceItems` filtra os itens só por `note_id` e os impostos só por `item_id` —
 * quem barrava nota de outra loja era a RLS. O role desta API tem `BYPASSRLS`.
 *
 * Aqui a amarra é direta e não derivada: as quatro views de imposto **têm `store_id`**,
 * então cada JOIN carrega o recorte. Não dependemos de "o id veio de uma consulta que já
 * filtrou" — dependência que quebra em silêncio quando alguém reordena o código.
 *
 * No browser eram CINCO idas ao Supabase (itens + 4 de imposto) cruzadas por `Map`.
 *
 * Valores fiscais viajam como **string**: o item de uma nota autorizada tem que bater
 * centavo a centavo com o XML enviado à SEFAZ, e ponto flutuante não garante isso.
 *
 * $1 = noteId, $2 = storeId.
 */
export const NFCE_ITEMS_SQL = `
select
  i.item_number              as item,
  i.product_code             as codigo_produto,
  i.ean_code                 as ean,
  i.description              as descricao,
  i.ncm                      as ncm,
  i.cest                     as cest,
  i.cfop                     as cfop,
  i.commercial_unit          as unidade,
  i.commercial_quantity      as quantidade,
  i.unit_price               as preco_unitario,
  i.gross_total              as valor_bruto,
  i.discount_value           as desconto,
  i.freight_value            as frete,
  i.insurance_value          as seguro,
  i.other_expenses_value     as outras_despesas,
  i.line_additional_info     as info_adicional,
  i.scale_indicator          as scale_indicator,
  i.rtrib_v_item             as rtrib_v_item,

  icms.origin                as icms_origem,
  -- CST e CSOSN são excludentes (regime normal x Simples): a tela mostra o que houver.
  coalesce(icms.cst, icms.csosn) as icms_cst_csosn,
  icms.bc_value              as icms_bc,
  icms.icms_rate             as icms_aliquota,
  icms.icms_value            as icms_valor,
  icms.icms_st_value         as icms_st_valor,
  icms.fcp_value             as icms_fcp_valor,
  icms.sn_credit_rate        as sn_aliq_credito,
  icms.sn_credit_value       as sn_valor_credito,

  pis.cst                    as pis_cst,
  pis.bc_value               as pis_bc,
  pis.pis_rate               as pis_aliquota,
  pis.pis_value              as pis_valor,
  pis.bc_quantity            as pis_bc_quantity,
  pis.pis_rate_reais         as pis_rate_reais,

  cof.cst                    as cofins_cst,
  cof.bc_value               as cofins_bc,
  cof.cofins_rate            as cofins_aliquota,
  cof.cofins_value           as cofins_valor,
  cof.bc_quantity            as cofins_bc_quantity,
  cof.cofins_rate_reais      as cofins_rate_reais,

  tax.total_taxes_value      as total_tributos
from public.vw_nfce_items i
left join public.vw_nfce_items_icms   icms on icms.item_id = i.id and icms.store_id = $2::uuid
left join public.vw_nfce_items_pis    pis  on pis.item_id  = i.id and pis.store_id  = $2::uuid
left join public.vw_nfce_items_cofins cof  on cof.item_id  = i.id and cof.store_id  = $2::uuid
left join public.vw_nfce_items_tax    tax  on tax.item_id  = i.id and tax.store_id  = $2::uuid
where i.note_id = $1::uuid and i.store_id = $2::uuid
order by i.item_number`;
