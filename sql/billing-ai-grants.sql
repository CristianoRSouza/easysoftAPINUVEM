-- =============================================================================
-- GRANTs para os módulos /billing e /ai da EasyFood API (role easyfood_api).
-- =============================================================================
-- Versão INCREMENTAL de sql/least-privilege-role.sql: rode isto em bancos onde o
-- role já existe. Sem estes grants as rotas novas respondem 500
-- ("permission denied for table ..."), porque o role tem BYPASSRLS mas NÃO tem
-- acesso implícito a nada — a contenção dele é justamente a lista de grants.
--
-- ⚠️ RODE BLOCO A BLOCO, não o arquivo inteiro de uma vez.
--    O SQL Editor do Supabase envolve a execução numa transação: se UMA tabela do
--    bloco não existir com esse nome, o Postgres aborta e desfaz TODOS os grants
--    anteriores — e a mensagem de erro fala só da tabela que faltou, não do resto
--    que foi perdido junto. Você acharia que aplicou e as rotas continuariam em 500.
--
-- ── Sobre a regra "a API não escreve em billing" ──────────────────────────────
-- A regra é ABSOLUTA para dado de cobrança: preço, licença, crédito, registro de
-- uso e Stripe são do EasyBilling; esta API só LÊ, para mostrar o extrato na tela.
--
-- Uma versão anterior deste arquivo abria exceção: concedia INSERT em `usage_log` e
-- `credit_transactions`, porque a IA era implementada aqui e media o próprio
-- consumo. Essa exceção MORREU com o ADR-0003 — quem mede e cobra IA é o
-- EasyBilling, e o chat daqui apenas encaminha para lá.
--
-- Manter aquele INSERT seria deixar a porta encostada: bastaria alguém reintroduzir
-- o código para voltarem a existir duas réguas cobrando da mesma carteira. Sem o
-- grant, essa volta falha na hora, em vez de cobrar o cliente em dobro em silêncio.
-- Se o seu banco já recebeu a versão anterior, rode o BLOCO 3.
-- =============================================================================


-- =============================================================================
-- BLOCO 0 — confira ANTES de conceder (não altera nada)
-- =============================================================================

select table_schema, table_name, table_type
  from information_schema.tables
 where table_schema = 'billing'
   and table_name in (
         'credit_transactions', 'usage_log', 'usage_log_enriched',
         'company_licenses', 'module_plans', 'ai_chat_sessions'
       )
 order by table_name;


-- =============================================================================
-- BLOCO 1 — painel de créditos, licença e planos (LEITURA)
-- =============================================================================
-- Sem este bloco: /billing/credits, /usage, /license, /plan-window e /plans dão 500.
-- `usage_log_enriched` é uma VIEW sobre `usage_log`; o grant vai nas DUAS porque a
-- view só repassa o privilégio se for security_invoker.
--
-- Note que aqui só há SELECT, inclusive nas duas tabelas de cobrança: a tela mostra
-- o extrato do que o EasyBilling registrou. Ler o extrato é diferente de escrevê-lo.

grant usage on schema billing to easyfood_api;

grant select on billing.credit_transactions to easyfood_api;
grant select on billing.usage_log           to easyfood_api;
grant select on billing.usage_log_enriched  to easyfood_api;
grant select on billing.company_licenses    to easyfood_api;
grant select on billing.module_plans        to easyfood_api;


-- =============================================================================
-- BLOCO 2 — histórico de conversas do assistente
-- =============================================================================
-- O histórico é do PRODUTO, não do provedor de IA: é a única parte do assistente
-- que continua sendo escrita por esta API.
--
-- CRUD completo. O `on conflict` do upsert LÊ o índice para detectar o conflito,
-- então SELECT é obrigatório junto do INSERT — só INSERT dá "permission denied".
--
-- Não há grant para `ai_kb_topics`: a base de conhecimento é lida pelo EasyBilling,
-- que monta o prompt. Esta API não a consulta mais.

grant select, insert, update, delete on billing.ai_chat_sessions to easyfood_api;


-- =============================================================================
-- BLOCO 3 — RETIRADA dos privilégios da IA que saiu daqui
-- =============================================================================
-- Rode SOMENTE se este banco recebeu a versão anterior deste arquivo (a que
-- concedia INSERT de medição e SELECT na base de conhecimento). É o que fecha a
-- porta descrita no cabeçalho.
--
-- Seguro de rodar mesmo se os grants nunca existiram: `revoke` de privilégio
-- ausente não é erro. Já `ai_kb_topics` pode não existir neste banco — se der
-- "relation does not exist", rode aquela linha separada e siga.

revoke insert on billing.usage_log           from easyfood_api;
revoke insert on billing.credit_transactions from easyfood_api;
revoke select on billing.ai_kb_topics        from easyfood_api;

-- `public.activity_logs` recebia a trilha de auditoria do chat, escrita pelo código
-- de IA que saiu daqui. Nenhuma rota desta API escreve nessa tabela hoje.
revoke insert on public.activity_logs from easyfood_api;


-- =============================================================================
-- CONFERÊNCIA — rode depois; é o que prova que o script pegou
-- =============================================================================

select table_schema, table_name,
       string_agg(privilege_type, ', ' order by privilege_type) as privilegios
  from information_schema.role_table_grants
 where grantee = 'easyfood_api'
   and (table_schema = 'billing'
        or (table_schema = 'public' and table_name = 'activity_logs'))
 group by table_schema, table_name
 order by table_schema, table_name;

-- Esperado:
--   billing  ai_chat_sessions     DELETE, INSERT, SELECT, UPDATE
--   billing  company_licenses     SELECT
--   billing  credit_transactions  SELECT      ← SELECT só; o INSERT é do EasyBilling
--   billing  device_licenses      SELECT      (já existia — licença de totem)
--   billing  module_plans         SELECT
--   billing  usage_log            SELECT      ← idem
--   billing  usage_log_enriched   SELECT
--
-- `ai_kb_topics` e `public.activity_logs` NÃO devem aparecer. Se aparecerem, o
-- BLOCO 3 não rodou — e o banco ainda permite que a cobrança volte a ser duplicada.
