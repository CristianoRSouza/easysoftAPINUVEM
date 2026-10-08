-- =============================================================================
-- Role de MENOR PRIVILÉGIO para a EasyFood API (NÃO usar 'postgres').
-- =============================================================================
-- Aplicar no banco do Supabase (cloud) e apontar DATABASE_URL para este role.
--
-- MODELO DE AMEAÇA: a API é a CAMADA CONFIÁVEL que substitui o `authenticated` do
-- browser — mesmo papel do `service_role` do Supabase, que por design tem BYPASSRLS.
-- As políticas RLS destas tabelas miram só `{authenticated}` (o navegador); a autorização
-- da API é em CÓDIGO (chokepoint, is_company_admin_for_store). Por isso este role TEM
-- BYPASSRLS — sem ele, RLS barra tudo (o hub_sessions nem tem política = nega tudo).
-- A contenção NÃO é a RLS; é a LISTA ESTREITA DE GRANTS abaixo (9 tabelas + 2 funções) mais:
-- não é dono (sem DDL/DROP), não é superusuário, não acessa o schema `auth` nem o resto
-- do banco. Se a API vazar, o estrago fica preso a estas tabelas — muito menos que `postgres`.
--
-- ORDEM: rode DEPOIS das migrações de schema. Em especial `hub_sessions` PRECISA
--   existir (a migração 20260728221553_hub_sessions.sql). Se der
--   `relation "public.hub_sessions" does not exist`, você está num banco onde essa
--   migração ainda não foi aplicada (ex.: PRODUÇÃO) — aplique as migrações primeiro.
--
-- Conjunto de grants VALIDADO ao vivo (SET ROLE + rollback) contra o schema do homolog
-- em 2026-07-29: replay do provisionamento inteiro passou sob este role. As triggers
-- pesadas (estoque, grupo padrão, auditoria RBAC, admin_users, sync de role legado) são
-- SECURITY DEFINER → rodam como o DONO, sem exigir grant extra aqui.

-- bypassrls: é a camada confiável (ver MODELO DE AMEAÇA). noinherit: sem herança de
-- outros roles. SEM createdb/createrole/superuser: não escala privilégio.
create role easyfood_api login password 'TROQUE-ESTA-SENHA' noinherit bypassrls;

grant connect on database postgres to easyfood_api;
grant usage on schema public to easyfood_api;

-- IDENTIDADE (login / me / sso / derived-session + resolver usuário no provisionamento):
-- NÃO há grant no schema `auth` de propósito. Toda leitura/escrita de usuário passa pela
-- PORTARIA GoTrue (admin.getUserById / createUser / generateLink) com a SERVICE_ROLE key
-- via HTTPS — não pelo pg (EasyML §6). Motivo prático além do desenho: o schema `auth` é
-- do `supabase_admin`; nem o `postgres` consegue conceder USAGE nele (o GRANT vira no-op
-- silencioso). Então este role é PURO `public.*`.

-- Sessões (hub_sessions): CRUD (o logout faz DELETE).
grant select, insert, update, delete on public.hub_sessions to easyfood_api;

-- Provisionamento: SELECT/INSERT/UPDATE nas tabelas de tenant (a lógica é transação na
-- API; ela NUNCA faz DELETE aqui → sem privilégio de delete, por menor privilégio).
grant select, insert, update on
  public.pv_companies, public.pv_stores, public.pb_profiles,
  public.pv_user_roles, public.pb_user_company_access, public.pv_store_api_keys
  to easyfood_api;

-- Disparado por TRIGGER (SECURITY INVOKER, sem exception handler): o INSERT em
-- pv_companies chama seed_company_product_seasons, que faz
-- `INSERT ... ON CONFLICT (company_id, legacy_code) DO NOTHING` em pv_product_seasons.
-- Precisa de SELECT **e** INSERT: o ON CONFLICT DO NOTHING lê o índice para detectar o
-- conflito (só INSERT dá `permission denied`). SEM isso o provisionamento inteiro falha.
grant select, insert on public.pv_product_seasons to easyfood_api;

-- Defensivo: a trigger resolve_store_city_state_id (SECURITY INVOKER) LÊ pb_cities
-- QUANDO a loja traz city_code/city_id. A API hoje não envia esses campos, então não
-- dispara; mas a trigger engole o erro num EXCEPTION WHEN OTHERS → sem este grant, se
-- alguém passar city_code no futuro, o city_id/state_id fica NULL EM SILÊNCIO. Barato
-- (dado de referência, só leitura) — concedemos para não criar essa armadilha.
grant select on public.pb_cities to easyfood_api;

-- Autorização de loja (bootstrap-code / cifra TEF do totem): EXECUTE na função de authz.
grant execute on function public.is_company_admin_for_store(uuid, uuid) to easyfood_api;

-- Isolamento multi-tenant (TenantGuard): vínculo usuário↔empresa e acesso de usuário
-- COMUM a uma loja. Ver sql/tenant-access-grants.sql (mesmos grants, versão incremental
-- para bancos onde o role já existe).
grant execute on function public.has_company_access(uuid, uuid) to easyfood_api;
grant select on public.pb_user_store_access to easyfood_api;

-- Rotas de LEITURA do catálogo (onda 3.1). Só select: quem escreve produto/unidade é o
-- Sync (Firebird -> nuvem), não o Manager.
grant select on public.pv_products, public.pv_product_units to easyfood_api;
grant select on public.vw_nfce_product_fiscal to easyfood_api;

-- Rotas de LEITURA da operação (onda 3.2): comandas, itens e transações. Views sobre as
-- tabelas particionadas do schema `command`; quem grava é o PDV/totem + Sync.
grant select on public.vw_command_orders, public.vw_command_order_items,
                public.vw_command_transactions to easyfood_api;

-- NFC-e (onda 3.3), leitura. vw_nfce_notes e tambem onde a API confere se a nota
-- pertence a loja pedida (a RLS nao vale aqui — este role tem BYPASSRLS).
grant select on public.vw_nfce_notes, public.vw_nfce_recipient, public.vw_nfce_payments,
                public.vw_nfce_logs, public.vw_nfce_events to easyfood_api;

-- CBS/IBS (onda 3.4) — referencia fiscal GLOBAL: nenhuma destas tabelas tem store_id ou
-- company_id, e legislacao igual para todas as empresas (por isso as rotas sao
-- @SkipTenant). Quem popula e o sync com a base do governo, nao o Manager.
grant select on public.pb_states, public.pb_cities, public.pb_cbs_union_rates,
                public.pb_cbs_state_rates, public.pb_cbs_municipal_rates, public.pb_cbs_cst,
                public.pb_cbs_cst_ind, public.pb_cbs_cst_is, public.pb_cbs_cclasstrib,
                public.pb_cbs_cclasstrib_ind, public.pb_cbs_cclasstrib_is,
                public.pb_cbs_cclasstrib_dfe_types, public.pb_cbs_is_ncm,
                public.pb_cbs_ccredpres, public.pb_cbs_fund_legais to easyfood_api;

-- Dispositivos (onda 3.5, leitura): agentes de NFC-e e auditoria de totem/agente.
-- vw_nfce_service_agent e tambem onde a API confere se o agente e da empresa.
grant select on public.vw_nfce_service_agent, public.vw_nfce_service_agent_audit,
                public.vw_devices_totem_config, public.vw_devices_totem_config_audit
                to easyfood_api;

-- Licencas de totem (schema billing) — LEITURA. A API e CLIENTE do billing (EasyML §10):
-- le licenca e aplica enforcement, nunca escreve. Guard test impede a escrita no codigo.
grant usage  on schema billing to easyfood_api;
grant select on billing.device_licenses to easyfood_api;

-- Validador de lookup chamado por trigger durante o INSERT em pv_stores (e afins).
-- É SECURITY DEFINER, mas teve o EXECUTE revogado do public → o chamador precisa de
-- EXECUTE explícito, senão o insert de loja falha com "permission denied for function".
grant execute on function public.validate_lookup_value(character varying, character varying) to easyfood_api;

-- Fila de sync (schema ecb_sync) — camada 1b do cutover do Sync-PG-SB (módulo /sync da API).
-- outbox: SELECT (pull do pending) + UPDATE (marcar dispatched).
-- inbox: SELECT + INSERT (o ON CONFLICT (event_id) DO NOTHING lê o índice → precisa de SELECT).
grant usage on schema ecb_sync to easyfood_api;
grant select, update on ecb_sync.outbox to easyfood_api;
grant select, insert on ecb_sync.inbox to easyfood_api;

-- NOTAS:
--  • Este role NÃO acessa o schema `auth` — identidade é 100% via GoTrue (ver acima).
--  • Sem sequences a conceder: as PKs usam gen_random_uuid() (execute é público), não serial/identity.
--  • Os casts de enum (::store_type, ::access_status) funcionam: USAGE de tipo é público por padrão.
--  • Se um dia uma trigger NOVA e SECURITY INVOKER passar a tocar outra tabela, o replay de
--    validação (SET ROLE easyfood_api; BEGIN; ...replay do persist()...; ROLLBACK) acusa na hora.
