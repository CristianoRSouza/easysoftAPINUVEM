/**
 * Configuração de totem — leitura, com os segredos REDIGIDOS.
 *
 * ── Decisão B, tomada em 2026-07-30 ────────────────────────────────────────────
 * A view tem quatro colunas sensíveis: `nfce_service_api_key`, `tef_http_api_key` e os
 * dois tokens Aditum cifrados. Hoje o browser recebe as duas primeiras **em claro**.
 *
 * O que decidiu a questão: no modo nuvem o navegador **não usa** essas chaves. O único
 * uso delas ali eram os botões "Testar conexão", e o próprio navegador os bloqueia
 * (página HTTPS chamando serviço HTTP na LAN — ver `assertLocalFetchAllowed` no
 * TotemFormDialog). Ou seja, viajavam para nada.
 *
 * Então a API devolve `<campo>_set` (booleano) em vez do valor. O campo na tela vira
 * somente-escrita: mostra se há chave e aceita uma nova para substituir — o padrão de
 * qualquer campo de senha.
 *
 * ⚠️ NUNCA acrescentar as colunas cruas a este SELECT. O ponto da rota é que o valor não
 * sai do servidor; um `select *` aqui desfaz a decisão em silêncio. Há teste cobrindo.
 *
 * Modo LAN e Electron seguem intocados — não passam por esta rota.
 *
 * $1 = companyId, $2 = storeId (nulo = todos os totens da empresa).
 */
export const TOTEMS_SQL = `
select
  t.id, t.company_id, t.store_id, t.totem_name, t.is_active,
  t.created_at, t.updated_at,

  -- Impressora
  t.printer_enabled, t.printer_model, t.printer_port, t.printer_code_page,
  t.printer_cols_normal, t.printer_cut_paper, t.printer_cut_type,
  t.printer_translate_tags, t.printer_ignore_tags, t.printer_verify,
  t.printer_line_feed_after, t.printer_copies, t.printer_timeout_ms,

  -- NFC-e / TEF / PIX: URLs e ajustes sim; CHAVES não (ver cabeçalho).
  t.nfce_service_url, t.nfce_emit_timeout_ms, t.nfce_serie, t.nfce_environment,
  t.tef_http_base_url, t.tef_base_url, t.tef_insecure_tls, t.establishment_cnpj,
  t.tef_application_name, t.tef_application_version, t.tef_contactless,
  t.tef_poll_interval_ms, t.tef_poll_max_ms, t.tef_credit_installment_type,
  t.tef_confirm_after_charge, t.tef_claim_source_statuses,
  t.tef_enable_worker_pending_job,
  t.pix_http_base_url,
  t.payment_credit_enabled, t.payment_debit_enabled, t.payment_pix_enabled,
  -- Voucher via to_jsonb: a coluna chega pela migração do EasyFoodManager-Web, que pode
  -- aplicar depois do deploy desta API; ler t.payment_voucher_enabled direto derrubaria a listagem.
  coalesce((to_jsonb(t) ->> 'payment_voucher_enabled')::boolean, false) as payment_voucher_enabled,
  coalesce(to_jsonb(t) ->> 'payment_voucher_kind', 'meal')              as payment_voucher_kind,
  t.payment_environment, t.app_mode,
  t.image_server_host, t.image_server_port,
  t.last_heartbeat_at, t.heartbeat_machine_id,

  -- Segredos: só a EXISTÊNCIA viaja. Espaço em branco não conta como configurado.
  (coalesce(btrim(t.nfce_service_api_key), '') <> '')            as nfce_service_api_key_set,
  (coalesce(btrim(t.tef_http_api_key), '') <> '')                as tef_http_api_key_set,
  (coalesce(btrim(t.pix_http_api_key), '') <> '')                as pix_http_api_key_set,
  (coalesce(btrim(t.aditum_partner_token_encrypted), '') <> '')  as aditum_partner_token_set,
  (coalesce(btrim(t.aditum_activation_code_encrypted), '') <> '') as aditum_activation_code_set,
  -- O kid não é segredo (identifica QUAL chave cifrou) e é preciso para rotação.
  t.aditum_partner_token_kid, t.aditum_activation_code_kid,

  -- Licença vinculada (schema billing — LEITURA; a fronteira proíbe escrever).
  lic.id                      as license_id,
  lic.status                  as license_status,
  lic.license_type            as license_type,
  lic.plan_slug               as plan_slug,
  lic.starts_at               as license_starts_at,
  lic.expires_at              as license_expires_at,
  lic.max_transactions_month  as max_transactions_month
from public.vw_devices_totem_config t
left join lateral (
  select l.id, l.status, l.license_type, l.plan_slug, l.starts_at, l.expires_at,
         l.max_transactions_month
    from billing.device_licenses l
   where l.totem_config_id = t.id
     and l.company_id = $1::uuid
     and l.device_type = 'totem'
   -- Um totem pode ter mais de uma licença. A REAL ganha da demo: sem esta ordenação,
   -- um totem pago apareceria como demo só porque a linha de demo veio primeiro.
   order by (case when coalesce(l.plan_slug, '') = 'ecp-demo' then 1
                  when coalesce(l.plan_slug, '') <> ''        then 0
                  when lower(coalesce(l.license_type, '')) in ('', 'monthly', 'trial', 'demo') then 1
                  else 0 end),
            l.created_at desc
   limit 1
) lic on true
where t.company_id = $1::uuid
  and ($2::uuid is null or t.store_id = $2::uuid or t.store_id is null)
order by t.totem_name`;

/** Licenças de totem da empresa — base do mapa de rótulos da tela. */
export const TOTEM_LICENSES_SQL = `
select id, device_key, license_type, plan_slug, status, totem_config_id,
       starts_at, expires_at, max_transactions_month, created_at
  from billing.device_licenses
 where company_id = $1::uuid
   and device_type = 'totem'
   and ($2::uuid is null or store_id = $2::uuid or store_id is null)
 order by created_at, device_key, id`;

/**
 * Licenças ATIVAS que a tela pode oferecer: as livres **mais a que já está vinculada ao
 * totem em edição** ($3).
 *
 * O `$3` não é refinamento — sem ele a tela de edição quebra de duas formas ao mesmo
 * tempo, e as duas em silêncio. A empresa costuma ter exatamente uma licença por totem,
 * então filtrar só por `totem_config_id is null` devolve LISTA VAZIA quando se edita um
 * totem já licenciado:
 *
 *  1. O seletor "Trocar / vincular licença" aparece vazio, sem nem a licença atual.
 *  2. O cartão "Licença atual" mostra o NOME DO TOTEM no lugar do código da licença —
 *     o `TotemFormDialog` procura a licença na lista (`totem_config_id === totem.id`),
 *     não acha, e cai num objeto sintético montado com `totem.totem_name`.
 *
 * É a mesma regra que o caminho do Supabase já aplicava (`configId == null ||
 * configId === currentTotemId`); ela não veio junto na migração.
 */
export const TOTEM_AVAILABLE_LICENSES_SQL = `
select id, device_key, license_type, plan_slug, status, totem_config_id, created_at
  from billing.device_licenses
 where company_id = $1::uuid
   and device_type = 'totem'
   and status = 'active'
   and (totem_config_id is null or ($3::uuid is not null and totem_config_id = $3::uuid))
   and ($2::uuid is null or store_id = $2::uuid or store_id is null)
 order by created_at, device_key, id`;

/**
 * Nomes das colunas de segredo que NÃO podem aparecer numa resposta desta rota.
 * O teste usa esta lista — se alguém acrescentar a coluna crua ao SELECT, quebra.
 */
export const TOTEM_SECRET_COLUMNS = [
  'nfce_service_api_key',
  'tef_http_api_key',
  'pix_http_api_key',
  'aditum_partner_token_encrypted',
  'aditum_activation_code_encrypted',
] as const;
