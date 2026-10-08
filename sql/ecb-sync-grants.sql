-- =============================================================================
-- GRANTS de ecb_sync para a EasyFood API (Fase 1b — fila via API).
-- =============================================================================
-- INCREMENTAL: rode isto no banco onde o role `easyfood_api` JA EXISTE (PRODUCAO).
-- O least-privilege-role.sql CRIA o role (com senha placeholder); rodar aquele
-- arquivo inteiro em prod falharia com "role already exists". Este só concede os
-- grants novos do schema ecb_sync — os MESMOS já embutidos no least-privilege-role.sql.
--
-- Idempotente: GRANT repetido é no-op. Seguro para reexecutar.
-- Pré-requisito: o schema `ecb_sync` e as tabelas outbox/inbox já existem (Sync-PG-SB).
--
-- VALIDADO ao vivo em homolog via SET ROLE (2026-07-29): as 3 operações que a API faz
-- (SELECT outbox pending, INSERT inbox ON CONFLICT, UPDATE outbox dispatched) passam
-- sob o role só com estes grants.

-- outbox: SELECT (pull do pending) + UPDATE (marcar dispatched).
-- inbox: SELECT + INSERT (o ON CONFLICT (event_id) DO NOTHING lê o índice → precisa de SELECT).
grant usage on schema ecb_sync to easyfood_api;
grant select, update on ecb_sync.outbox to easyfood_api;
grant select, insert on ecb_sync.inbox to easyfood_api;

-- Conferência (opcional): deve listar as 3 tabelas/privilégios acima.
-- select table_schema, table_name, privilege_type
-- from information_schema.role_table_grants
-- where grantee = 'easyfood_api' and table_schema = 'ecb_sync'
-- order by table_name, privilege_type;
