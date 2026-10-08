/**
 * Configuração do emitente (dados fiscais da loja) — leitura.
 *
 * Junta numa consulta o que o browser busca em três: a loja, o certificado ativo e a
 * chave de API. O `pv_stores` guarda o cadastro fiscal; as duas laterais trazem o
 * certificado mais recente e a chave ativa.
 *
 * ── Segredos: o que sai e o que NÃO sai ───────────────────────────────────────
 * O mapeamento do browser **já anula** a senha do certificado e os tokens TEF, e já
 * mascara a chave de API (`prefixo••••••••`). Isso é preservado aqui — não estamos
 * afrouxando nada.
 *
 * O que muda é o **CSC** (`nfce_security_code`), o código que assina o QR Code da NFC-e:
 * quem tem CSC + CNPJ gera cupom fiscal válido no nome da loja. Hoje ele vai em claro
 * para qualquer um que abra a tela.
 *
 * **Decisão do usuário (2026-07-30, opção 3): só ADMIN da empresa vê o valor.**
 * Para os demais vem `null` + `nfce_security_code_set: true`. Motivo: quem configura o
 * emitente é sempre admin, então quem precisa ver continua vendo; quem não precisa deixa
 * de ver — sem quebrar o trabalho de ninguém. O `$3` abaixo é essa decisão.
 *
 * $1 = storeId, $2 = companyId, $3 = ehAdmin (boolean).
 */
export const ISSUER_CONFIG_SQL = `
select
  s.id,
  s.trade_name, s.cnpj, s.state_registration, s.municipal_registration, s.cnae,
  s.neighborhood, s.zip_code, s.email, s.is_active, s.notes, s.created_at, s.updated_at,

  -- ⚠️ APELIDOS: a tela le estes nomes, nao os das colunas. Sem eles a pagina do
  -- Emitente aparecia com Razao Social, Logradouro, Numero, Telefone e Pais VAZIOS,
  -- e "undefined" no Regime Tributario — porque o campo simplesmente nao existia na
  -- resposta. O renomear fica no SQL de proposito: coluna errada quebra a consulta na
  -- hora, enquanto um mapeador em JS erra em silencio.
  s.legal_name         as company_name,
  s.address            as street,
  s.address_number     as number,
  s.address_complement as complement,
  s.phone1             as phone,
  s.legacy_store_code  as legacy_loja_id,

  -- Regime: a fonte e o emitente que a LOJA sincroniza (nfce.issuer_config), nao o
  -- pv_stores — nenhum caminho grava tax_regime_id em pv_stores, entao ele fica nulo.
  -- O antigo default 3 fazia a tela afirmar "Regime Normal" para um emitente do Simples
  -- (EASYSOFT, 29/09/2026). Sem regime em lugar nenhum, vai null e a tela mostra "—".
  -- "code" e VARCHAR em pb_tax_regime; a tela espera numero.
  coalesce(ic.tax_regime_code, nullif(btrim(tr.code::text), '')::int)    as tax_regime_code,
  -- Mesma regra para o resto do cadastro fiscal que so a loja conhece: series, CSC,
  -- PIS/COFINS, IE ST e os textos infCpl (TBL_CONFIGURACAO 250/251). pv_stores fica
  -- como reserva. Colunas criadas pela migracao 20260929220000 do EasyFoodManager-Web —
  -- ela precisa estar aplicada no banco ANTES deste codigo subir.
  coalesce(ic.pis_cofins_regime_code::int, nullif(btrim(pcr.code::text), '')::int) as pis_cofins_regime_code,
  ic.state_registration_st,
  ic.inf_ad_fb_config_250,
  ic.inf_ad_fb_config_251,
  ct.code::text                                                          as municipality_code,
  ct.name                                                               as municipality_name,
  ct.state_acronym                                                      as uf,
  '1058'                                                                as country_code,
  'BRASIL'                                                              as country_name,
  -- pv_stores guarda a serie como char(3); a do emitente e inteiro.
  coalesce(ic.nfe_serie,
           case when btrim(s.nfe_series) ~ '^[0-9]+$' then btrim(s.nfe_series)::int end)   as nfe_serie,
  coalesce(ic.nfce_serie,
           case when btrim(s.nfce_series) ~ '^[0-9]+$' then btrim(s.nfce_series)::int end) as nfce_serie,
  coalesce(ic.nfce_security_code_id, s.nfce_security_code_id)          as nfce_security_code_id,

  -- CSC: valor só para admin; para os demais, apenas a existência.
  case when $3::boolean
       then coalesce(nullif(btrim(ic.nfce_security_code), ''), s.nfce_security_code)
       else null end                                                     as nfce_security_code,
  (coalesce(nullif(btrim(ic.nfce_security_code), ''), btrim(s.nfce_security_code), '') <> '')
                                                                         as nfce_security_code_set,

  s.certificate_serial, s.certificate_path, s.certificate_legal_name,
  s.certificate_authority, s.certificate_cnpj, s.certificate_expiry_date,
  s.certificate_type_code, s.crypto_library, s.certificate_access,

  -- Certificado nos nomes que a TELA le (os mesmos do nfce_issuer_config local). Antes
  -- so vinham certificate_subject_* e as colunas certificate_* do pv_stores, que nenhum
  -- caminho preenche — a tela mostrava Titular, CNPJ, AC e Tipo vazios com o certificado
  -- sincronizado na nuvem (EASYSOFT, 29/09/2026). A fonte e o certificado ativo;
  -- pv_stores fica como reserva.
  coalesce(nullif(btrim(cert.subject_name), ''), s.certificate_legal_name) as certificate_holder_name,
  coalesce(nullif(btrim(cert.subject_cnpj), ''), s.certificate_cnpj)       as certificate_holder_cnpj,
  coalesce(nullif(btrim(cert.issuer_name), ''), s.certificate_authority)   as certificate_authority_name,
  coalesce(nullif(btrim(ic.certificate_series), ''), nullif(btrim(cert.serial_number), ''),
           s.certificate_serial)                                        as certificate_series,
  -- cert_type e certificate_type_code sao texto ('2'); a tela espera numero.
  coalesce(case when btrim(cert.cert_type) ~ '^[0-9]+$' then btrim(cert.cert_type)::int end,
           case when btrim(s.certificate_type_code) ~ '^[0-9]+$'
                then btrim(s.certificate_type_code)::int end)           as certificate_type,
  -- Caminhos, exportacao e flags ACBr so a loja conhece: vem do emitente sincronizado
  -- (colunas da migracao 20260929230000 do EasyFoodManager-Web).
  coalesce(ic.certificate_pfx_relative_path, s.certificate_path)       as certificate_pfx_relative_path,
  ic.certificate_source_path,
  ic.certificate_exported_at,
  coalesce(ic.crypto_library_flag, s.crypto_library)                   as crypto_library_flag,
  coalesce(ic.certificate_access_flag, s.certificate_access)           as certificate_access_flag,

  cert.version         as certificate_version,
  cert.thumbprint      as certificate_thumbprint,
  cert.valid_from      as certificate_valid_from,
  coalesce(cert.valid_until, s.certificate_expiry_date) as certificate_valid_until,
  cert.source          as certificate_source,
  cert.subject_name    as certificate_subject_name,
  cert.subject_cnpj    as certificate_subject_cnpj,
  cert.issuer_name     as certificate_issuer_name,
  cert.serial_number   as certificate_serial_number,
  cert.cert_type       as certificate_cert_type,

  -- Chave de API: só o PREFIXO viaja (o valor completo nunca existiu no banco em claro,
  -- é hash + prefixo). A tela mostra "prefixo••••••••".
  ak.key_prefix        as api_key_prefix,
  ak.expires_at        as api_key_expires_at,
  ak.last_used_at      as api_key_last_used_at,
  -- Chave: a emitida pela NUVEM (pv_store_api_keys) ou a gravada na LOJA (cifrada, so la;
  -- a nuvem sabe apenas que existe). A tela diz qual das duas para nao sugerir erro de
  -- decifragem quando a chave simplesmente mora na loja.
  (ak.key_prefix is not null or coalesce(ic.apikey_easyerp_set, false))  as easyerp_api_key_set,
  case when ak.key_prefix is not null then 'nuvem'
       when coalesce(ic.apikey_easyerp_set, false) then 'loja' end      as easyerp_api_key_origem,

  -- TEF Aditum (token/código cifrados na loja) e X-Api-Key do TEF Admin: o valor nunca
  -- sai daqui (ISSUER_NULL_SECRETS); a tela mostra "definido" pelos indicadores, com os
  -- mesmos nomes que a Admin API local manda. Migracao 20260929233000 do Manager-Web.
  coalesce(ic.aditum_tef_partner_token_set, false)   as aditum_tef_partner_token_encrypted_set,
  coalesce(ic.aditum_tef_activation_code_set, false) as aditum_tef_activation_code_encrypted_set,
  ic.tef_admin_http_base_url,
  coalesce(ic.tef_admin_http_api_key_set, false)     as tef_admin_http_api_key_set,

  s.company_id         as companyid_easyerp,
  s.id                 as storeid_easyerp
from public.pv_stores s
left join public.pb_tax_regime         tr  on tr.id  = s.tax_regime_id
left join public.pb_pis_cofins_regime  pcr on pcr.id = s.pis_cofins_regime_id
left join public.pb_cities             ct  on ct.id  = s.city_id
left join lateral (
  select tax_regime_code, pis_cofins_regime_code, state_registration_st,
         nfce_serie, nfe_serie, nfce_security_code, nfce_security_code_id,
         inf_ad_fb_config_250, inf_ad_fb_config_251,
         certificate_series, certificate_pfx_relative_path, certificate_source_path,
         certificate_exported_at, crypto_library_flag, certificate_access_flag,
         apikey_easyerp_set, aditum_tef_partner_token_set, aditum_tef_activation_code_set,
         tef_admin_http_base_url, tef_admin_http_api_key_set
    from nfce.issuer_config
   where store_id = s.id and company_id = $2::uuid
   order by is_active desc, updated_at desc
   limit 1
) ic on true
left join lateral (
  select version, thumbprint, valid_from, valid_until, source, subject_name,
         subject_cnpj, issuer_name, serial_number, cert_type
    from public.vw_nfce_certificate_active
   where store_id = s.id and company_id = $2::uuid
   order by created_at desc
   limit 1
) cert on true
left join lateral (
  select key_prefix, expires_at, last_used_at
    from public.pv_store_api_keys
   where store_id = s.id and is_active = true
   order by created_at desc
   limit 1
) ak on true
where s.id = $1::uuid
  and s.company_id = $2::uuid
  and coalesce(s.is_deleted, false) = false
limit 1`;
