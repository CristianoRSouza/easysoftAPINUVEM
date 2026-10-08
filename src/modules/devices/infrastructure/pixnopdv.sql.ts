/**
 * Credenciais do PIXnoPDV (produção) — leitura, com os segredos REDIGIDOS.
 *
 * ── Por que a redação aqui não custou nenhuma decisão ─────────────────────────
 * `basic_token` e `secret_key` viajam hoje do banco até o navegador. Só que o
 * `mapPixnopdvRowToView` do Manager-Web **já os converte em booleanos**
 * (`basic_token_set` / `secret_key_set`) e a tela nunca usa os valores.
 *
 * Ou seja: exatamente o caso das chaves do totem — a credencial atravessa a rede para
 * nada. Aqui a API já devolve o booleano e o valor não sai do servidor. A tela não muda.
 *
 * ⚠️ NUNCA acrescentar `basic_token` ou `secret_key` crus a este SELECT. Há teste cobrindo.
 *
 * A tabela vive no schema `devices` (não em `public`) — foi por isso que ela sumiu na
 * primeira varredura que fiz só no schema padrão.
 *
 * $1 = companyId, $2 = storeId.
 */
export const PIXNOPDV_SQL = `
select
  store_id,
  environment,
  api_base_url,
  basic_user,
  insecure_tls,
  enabled,
  updated_at,
  -- Só a EXISTÊNCIA. Espaço em branco não conta como configurado.
  (coalesce(btrim(basic_token), '') <> '') as basic_token_set,
  (coalesce(btrim(secret_key), '')  <> '') as secret_key_set
from devices.pixnopdv_store_credentials
where company_id = $1::uuid
  and store_id = $2::uuid
  and environment = 'producao'
limit 1`;

/** Colunas que não podem aparecer numa resposta desta rota. O teste usa esta lista. */
export const PIXNOPDV_SECRET_COLUMNS = ['basic_token', 'secret_key'] as const;
