import type { Request } from 'express';

/**
 * A requisição DEPOIS dos guards globais — o que cada um deixa escrito nela.
 *
 * Existe para os controllers pararem de redeclarar `Request & { companyId: string; ... }`
 * cada um à sua maneira. Na prática quase nenhum controller precisa destes tipos: os
 * decorators de `request.decorators.ts` entregam o valor já pronto.
 */

/** Passou pelo `AuthGuard` com sessão de usuário: `req.user.id` é o dono da sessão. */
export type AuthenticatedRequest = Request & { user: { id: string } };

/**
 * Passou pelo `TenantGuard`: a empresa foi conferida no banco contra o usuário.
 * `storeId` só é garantido não-nulo nas rotas com `@RequireStore()`.
 */
export type TenantRequest = AuthenticatedRequest & {
  companyId: string;
  storeId: string | null;
  isCompanyAdmin?: boolean;
};
