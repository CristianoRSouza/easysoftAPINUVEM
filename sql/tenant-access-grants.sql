-- =============================================================================
-- GRANTS do TenantGuard para a EasyFood API (isolamento multi-tenant).
-- =============================================================================
-- INCREMENTAL: rode no banco onde o role `easyfood_api` JÁ EXISTE. O
-- least-privilege-role.sql CRIA o role; rodar aquele arquivo inteiro num banco já
-- provisionado falha com "role already exists". Este concede só o que o TenantGuard
-- passou a precisar — os MESMOS grants já embutidos no least-privilege-role.sql.
--
-- Idempotente: GRANT repetido é no-op. Seguro para reexecutar.
--
-- POR QUE ESTES DOIS, E SÓ ESTES:
-- O guard responde a uma pergunta por requisição — "este usuário pode agir nesta
-- empresa/loja?" — com UMA consulta. Ela usa:
--   • public.has_company_access(uuid, uuid)  → vínculo usuário↔empresa (inclui system_admin)
--   • public.is_company_admin_for_store(uuid, uuid) → JÁ concedido (bootstrap-code / TEF)
--   • public.pv_stores                        → JÁ concedido (provisionamento)
--   • public.pb_user_store_access             → NOVO: acesso de usuário COMUM a uma loja
--
-- O `pb_user_store_access` é o que permite um usuário não-admin enxergar a própria
-- loja. Sem ele, a regra degradaria para "só admin vê alguma coisa" — que é mais
-- restritivo, mas quebra o uso normal do Manager.
--
-- LEMBRETE DO MODELO DE AMEAÇA (ver least-privilege-role.sql): este role tem
-- BYPASSRLS de propósito. Com a RLS fora do caminho, a checagem em CÓDIGO é a única
-- barreira entre empresas — não é defesa em profundidade, é a defesa. Por isso o
-- TenantGuard é global e falha fechado.
-- =============================================================================

-- Acesso de usuário comum a uma loja (leitura; a API nunca escreve nesta tabela).
grant select on public.pb_user_store_access to easyfood_api;

-- Vínculo usuário↔empresa. Overload de DOIS argumentos: o de um argumento usa
-- auth.uid(), que é sempre NULL aqui — a API não abre sessão GoTrue no Postgres,
-- ela passa o id do dono da sessão explicitamente.
grant execute on function public.has_company_access(uuid, uuid) to easyfood_api;

-- -----------------------------------------------------------------------------
-- CATÁLOGO (onda 3.1) — GET /v1/products, /products/paged, /products/:id/fiscal, /units
-- -----------------------------------------------------------------------------
-- Só SELECT: estas rotas são de LEITURA. Quem escreve produto/unidade é o Sync
-- (Firebird -> nuvem), não o Manager. Conceder insert/update aqui daria à API um
-- privilégio que nenhuma rota usa.
grant select on public.pv_products      to easyfood_api;  -- filtrado por store_id
grant select on public.pv_product_units to easyfood_api;  -- filtrado por company_id

-- View de regra fiscal (ICMS/PIS/COFINS/IPI/CFOP) — a MESMA que o browser lia direto.
-- ⚠️ View com SECURITY INVOKER exige, além deste grant, privilégio nas tabelas-base.
-- Se der "permission denied for table ..." ao chamar /products/:id/fiscal, é isto:
-- confira o dono/segurança da view antes de sair concedendo as tabelas de baixo.
grant select on public.vw_nfce_product_fiscal to easyfood_api;

-- -----------------------------------------------------------------------------
-- OPERAÇÃO (onda 3.2) — /v1/orders, /order-items, /transactions, /dashboard/*
-- -----------------------------------------------------------------------------
-- Views sobre as tabelas particionadas do schema `command`. Só SELECT: comanda e
-- transação são gravadas pelo PDV/totem e sincronizadas pelo Sync — o Manager só lê.
grant select on public.vw_command_orders       to easyfood_api;
grant select on public.vw_command_order_items  to easyfood_api;
grant select on public.vw_command_transactions to easyfood_api;

-- -----------------------------------------------------------------------------
-- NFC-e (onda 3.3) — /v1/nfce/attention-counts, /notes e as filhas da nota
-- -----------------------------------------------------------------------------
-- vw_nfce_notes serve TAMBEM ao dashboard/revenue-approved (conta as notas ligadas
-- as transacoes aprovadas do periodo).
--
-- ⚠️ vw_nfce_notes nao e opcional para as rotas filhas: e nela que a API confere se a
-- nota pertence a loja pedida. No browser quem barrava nota de outra loja era a RLS;
-- este role tem BYPASSRLS, entao a amarra e o `exists` da consulta. Sem SELECT aqui,
-- as rotas de pagamentos/logs/eventos falham fechado — o que e o comportamento certo.
grant select on public.vw_nfce_notes     to easyfood_api;
grant select on public.vw_nfce_recipient to easyfood_api;
grant select on public.vw_nfce_payments  to easyfood_api;
grant select on public.vw_nfce_logs      to easyfood_api;
grant select on public.vw_nfce_events    to easyfood_api;

-- Verificação (rode como superusuário/dono; esperado: todas com has_privilege = t):
--   select 'pb_user_store_access' as obj,
--          has_table_privilege('easyfood_api', 'public.pb_user_store_access', 'select') as has_privilege
--   union all select 'pv_products',            has_table_privilege('easyfood_api', 'public.pv_products', 'select')
--   union all select 'pv_product_units',       has_table_privilege('easyfood_api', 'public.pv_product_units', 'select')
--   union all select 'vw_nfce_product_fiscal', has_table_privilege('easyfood_api', 'public.vw_nfce_product_fiscal', 'select')
--   union all select 'has_company_access(uuid,uuid)',
--          has_function_privilege('easyfood_api', 'public.has_company_access(uuid,uuid)', 'execute');

-- -----------------------------------------------------------------------------
-- CBS / IBS (onda 3.4) — tabelas de REFERENCIA FISCAL (legislacao)
-- -----------------------------------------------------------------------------
-- Sao dados GLOBAIS: nenhuma destas tabelas tem store_id ou company_id. Por isso as
-- rotas sao @SkipTenant — exigir X-Company-Id para ler a tabela de UFs seria teatro.
-- Só SELECT: quem popula estas tabelas e o sync com a base do governo, nao o Manager.
grant select on
  public.pb_states, public.pb_cities,
  public.pb_cbs_union_rates, public.pb_cbs_state_rates, public.pb_cbs_municipal_rates,
  public.pb_cbs_cst, public.pb_cbs_cst_ind, public.pb_cbs_cst_is,
  public.pb_cbs_cclasstrib, public.pb_cbs_cclasstrib_ind, public.pb_cbs_cclasstrib_is,
  public.pb_cbs_cclasstrib_dfe_types, public.pb_cbs_is_ncm, public.pb_cbs_ccredpres,
  public.pb_cbs_fund_legais
  to easyfood_api;

-- -----------------------------------------------------------------------------
-- DISPOSITIVOS (onda 3.5, leitura) — /v1/service-agents, /audit-logs
-- -----------------------------------------------------------------------------
-- vw_nfce_service_agent nao e opcional para /service-agents/:id/audit-logs: e nela
-- que a API confere se o agente pertence a empresa. No browser essa consulta filtra
-- so por agent_config_id e quem barrava agente alheio era a RLS; este role tem
-- BYPASSRLS. Sem SELECT aqui, a rota falha fechado — comportamento certo.
-- vw_devices_totem_config entra pelo nome do totem na auditoria unificada (LEFT JOIN);
-- as rotas de CONFIGURACAO de totem ainda nao existem (decisao pendente sobre as
-- chaves de API em claro).
grant select on public.vw_nfce_service_agent       to easyfood_api;
grant select on public.vw_nfce_service_agent_audit to easyfood_api;
grant select on public.vw_devices_totem_config     to easyfood_api;
grant select on public.vw_devices_totem_config_audit to easyfood_api;

-- Licencas de totem (schema billing) — LEITURA. A API e CLIENTE do billing (EasyML §10):
-- le licenca/credito e aplica enforcement, mas NUNCA escreve. Um guard test quebra o
-- build se alguem tentar insert/update/delete em billing.*.
grant usage  on schema billing to easyfood_api;
grant select on billing.device_licenses to easyfood_api;

-- -----------------------------------------------------------------------------
-- PAINEL DE SYNC (onda 4) — /v1/sync/inbox/* e /v1/sync/outbox/*
-- -----------------------------------------------------------------------------
-- As 17 RPCs ja recebem p_company_id/p_store_id — nasceram com o recorte de tenant.
-- A migracao muda a ORIGEM desses parametros: no browser vinham do localStorage (o
-- cliente declarava em nome de quem consultava, e a RLS era a unica barreira); aqui
-- vem do TenantGuard, que ja conferiu o vinculo no banco.
grant execute on function
  public.cloud_sync_inbox_summary(uuid, uuid),
  public.cloud_sync_inbox_by_entity(uuid, uuid),
  public.cloud_sync_inbox_failures_by_error(uuid, uuid),
  public.cloud_sync_inbox_backlog(uuid, uuid),
  public.cloud_sync_inbox_apply_rate(uuid, uuid),
  public.cloud_sync_inbox_active_retries(uuid, uuid, integer),
  public.cloud_sync_inbox_recent_failures(uuid, uuid, integer),
  public.cloud_sync_inbox_recent_applied(uuid, uuid, integer),
  public.cloud_sync_inbox_recent_all(uuid, uuid, integer, integer),
  public.cloud_sync_outbox_summary(uuid, uuid),
  public.cloud_sync_outbox_by_entity(uuid, uuid),
  public.cloud_sync_outbox_failures_by_error(uuid, uuid),
  public.cloud_sync_outbox_backlog(uuid, uuid),
  public.cloud_sync_outbox_dispatch_rate(uuid, uuid),
  public.cloud_sync_outbox_active_retries(uuid, uuid, integer),
  public.cloud_sync_outbox_recent_failures(uuid, uuid, integer),
  public.cloud_sync_outbox_recent_all(uuid, uuid, integer, integer)
  to easyfood_api;

-- -----------------------------------------------------------------------------
-- ULTIMAS LEITURAS — emitente, PIXnoPDV e imagens de produto
-- -----------------------------------------------------------------------------
-- Emitente: pv_stores e pv_store_api_keys JA estao concedidos (provisionamento);
-- falta so o certificado ativo.
grant select on public.vw_nfce_certificate_active to easyfood_api;
-- Regime tributario (29/09/2026): a consulta do emitente junta pb_tax_regime e
-- pb_pis_cofins_regime (referencia, so leitura) e le o CRT de nfce.issuer_config, que a
-- LOJA sincroniza — pv_stores.tax_regime_id nunca e preenchido. So SELECT, so esta
-- tabela: o USAGE no schema nfce nao abre as demais (notas, itens), que continuam
-- chegando pelas views vw_nfce_*.
grant select on public.pb_tax_regime, public.pb_pis_cofins_regime to easyfood_api;
grant usage  on schema nfce to easyfood_api;
grant select on nfce.issuer_config to easyfood_api;

-- PIXnoPDV vive no schema `devices`, nao em `public` — foi por isso que ele "sumiu"
-- numa varredura que olhou so o schema padrao. Só SELECT: a rota devolve
-- basic_token_set/secret_key_set (booleanos) e NUNCA os valores.
grant usage  on schema devices to easyfood_api;
grant select on devices.pixnopdv_store_credentials to easyfood_api;

-- -----------------------------------------------------------------------------
-- ESCRITAS de dispositivo (ativar/desativar, requeue, PIXnoPDV)
-- -----------------------------------------------------------------------------
-- ⚠️ As duas RPCs recebem SO o id do totem — nao tem recorte de tenant. A API confere
-- o vinculo totem<->empresa ANTES de chamar (403 se nao for). Sem essa checagem, um id
-- alheio desativaria o totem de outra loja.
grant execute on function public.cloud_set_totem_active(uuid, boolean, uuid) to easyfood_api;
grant execute on function public.cloud_requeue_totem_sync(uuid) to easyfood_api;

-- Agente: o UPDATE leva company_id no WHERE (correcao do .eq("id", id) do browser).
grant update on public.vw_nfce_service_agent to easyfood_api;

-- PIXnoPDV: insert + update (upsert por empresa/loja/ambiente).
grant insert, update on devices.pixnopdv_store_credentials to easyfood_api;

-- Criacao/edicao de agente: insert na tabela e na auditoria (a auditoria vai na MESMA
-- transacao do insert — gravar o agente e perder o rastro de quem o criou e pior que
-- falhar os dois).
grant insert on public.vw_nfce_service_agent to easyfood_api;
grant insert on public.vw_nfce_service_agent_audit to easyfood_api;

-- -----------------------------------------------------------------------------
-- CRIACAO / EDICAO DE TOTEM
-- -----------------------------------------------------------------------------
grant insert, update on public.vw_devices_totem_config to easyfood_api;
grant insert on public.vw_devices_totem_config_audit to easyfood_api;

-- A regra "demo nao opera em producao" LE a licenca. So SELECT, e de proposito: escrever
-- em billing e do produto de billing (EasyML §10), e ha um teste que quebra o build se
-- alguem tentar. Quem grava o vinculo totem<->licenca e a RPC cloud_set_totem_active,
-- que roda SECURITY DEFINER dentro do banco.
grant usage  on schema billing to easyfood_api;
grant select on billing.device_licenses to easyfood_api;

-- -----------------------------------------------------------------------------
-- ⚠️ O GRANT MENOS OBVIO DESTE ARQUIVO — sem ele as rotas de totem quebram
-- -----------------------------------------------------------------------------
-- cloud_set_totem_active e cloud_requeue_totem_sync sao SECURITY DEFINER e autorizam por
-- auth.uid(), a identidade que o Supabase injeta no JWT. Esta API nao usa JWT do Supabase:
-- conecta como easyfood_api, e ali auth.uid() e NULO — a funcao nega tudo com
-- totem_access_denied.
--
-- A correcao foi rodar essas chamadas por withRls, que abre a transacao com
--     set_config('role','authenticated') + set_config('request.jwt.claims', ...)
-- Trocar de role exige ser MEMBRO do role. Sem a linha abaixo, o erro nao e "acesso
-- negado": e falha ao trocar de role, no meio da transacao.
--
-- Provado no banco: sem contexto has_company_access() = false; com contexto = true.
--
-- Isto NAO alarga o role: easyfood_api e NOINHERIT (conferido em prod, PG 17.6). Ser
-- membro da o direito de TROCAR para authenticated dentro de uma transacao — nao da os
-- privilegios de authenticated o tempo todo. Se algum dia alguem recriar o role, tem de
-- vir NOINHERIT de novo, senao este grant vira uma ampliacao silenciosa de acesso.
--
-- Efeito colateral desejavel: enquanto esta como authenticated a conexao PERDE o
-- BYPASSRLS, entao a RLS volta a valer nessas chamadas.
grant authenticated to easyfood_api;
