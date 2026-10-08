import { SetMetadata } from '@nestjs/common';

/** Marca uma rota como pública (pula toda autenticação) — ex.: health, login. */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Marca uma rota como máquina-a-máquina (exige X-Service-Key, não sessão de usuário). */
export const IS_SERVICE_ONLY = 'isServiceOnly';
export const ServiceOnly = () => SetMetadata(IS_SERVICE_ONLY, true);

/**
 * Dispensa a rota do `X-Company-Id` (TenantGuard).
 *
 * Use quando a rota opera no contexto do USUÁRIO, não de uma empresa: `/auth/me`,
 * `/auth/sso/support`, telemetria. Também nas rotas que recebem o `store_id` no
 * path/body e fazem a própria checagem de autorização — elas já eram assim antes do
 * guard existir e o contrato delas não muda.
 *
 * ⚠️ Não use "porque o header incomoda". Sem tenant declarado, a rota tem que provar
 * de outro jeito que o usuário pode ver aquele dado — senão vira vazamento entre empresas.
 */
export const IS_SKIP_TENANT = 'isSkipTenant';
export const SkipTenant = () => SetMetadata(IS_SKIP_TENANT, true);

/**
 * Exige também o `X-Store-Id` (além do `X-Company-Id`), validado contra o acesso do
 * usuário. Para rotas cujo dado é sempre de UMA loja — produtos, pedidos, NFC-e.
 * Sem isto o header de loja é opcional: se vier, é validado; se não vier, `req.storeId`
 * fica `null` e a rota decide o que fazer.
 */
export const REQUIRES_STORE = 'requiresStore';
export const RequireStore = () => SetMetadata(REQUIRES_STORE, true);
