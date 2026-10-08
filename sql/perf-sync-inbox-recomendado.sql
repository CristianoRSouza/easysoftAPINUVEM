-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Monitor de Sincronização lento — o que resolver NO BANCO.  ⚠️ NÃO APLICADO.
--
-- Este arquivo é uma proposta medida, não uma migração: as RPCs `cloud_sync_inbox_*` e a
-- tabela `ecb_sync.inbox` são mantidas fora deste repositório. Revise e aplique pelo fluxo
-- de migração de quem é dono delas. A API não tem como contornar isto — ela só chama a RPC.
--
-- Medido em PRODUÇÃO em 08/10/2026 (EXPLAIN ANALYZE, somente leitura):
--   • a inbox tem ~300 mil eventos em 3 GB de heap, e UMA loja concentra 99,7% deles;
--   • `cloud_sync_inbox_summary`        → 4,4 s  (Index Only Scan com 198 mil idas ao heap);
--   • `cloud_sync_inbox_recent_applied` → 4,4 s  (lê as 300 mil linhas e ordena p/ devolver 50).
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- 1) recent-applied: o índice certo já existe, mas a consulta não consegue usá-lo.
--
--    `inbox_tenant_applied_at (company_id, store_id, applied_at) WHERE apply_status = 'applied'`
--    entrega, lido de trás para frente, `applied_at DESC NULLS FIRST`. A RPC pede
--    `ORDER BY applied_at DESC NULLS LAST` — ordem diferente —, então o planner descarta o
--    índice, varre tudo por `idx_inbox_pick` e ordena. Um índice na ordem pedida resolve sem
--    mexer na função (as 50 linhas saem direto do índice):
create index concurrently if not exists inbox_tenant_applied_at_desc
    on ecb_sync.inbox (company_id, store_id, applied_at desc nulls last)
 where apply_status = 'applied';
--    Depois de conferir que o plano mudou, o índice antigo fica sem uso e pode sair:
--    drop index concurrently if exists ecb_sync.inbox_tenant_applied_at;

-- 2) summary: a contagem já é Index Only Scan (`inbox_tenant_status`), mas 198 mil das 300 mil
--    linhas ainda vão ao heap, porque as páginas recém-escritas não estão marcadas como
--    "todas visíveis". A tabela recebe escrita o tempo todo e o autovacuum não acompanha.
--    Um VACUUM zera as idas ao heap na hora; o ajuste de autovacuum mantém assim.
vacuum (analyze) ecb_sync.inbox;
alter table ecb_sync.inbox set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02);

-- 3) A causa de fundo é o tamanho: a inbox é o livro-caixa de idempotência e não tem
--    retenção. Enquanto ela crescer, (1) e (2) só adiam o problema. O que uma política de
--    retenção apagaria — e o que deixaria de existir junto — está medido em
--    `scripts/diag-inbox-retencao.mjs`; é decisão de produto, não de índice.
