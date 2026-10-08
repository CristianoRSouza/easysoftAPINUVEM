import {
  createParamDecorator,
  InternalServerErrorException,
  type ExecutionContext,
} from '@nestjs/common';
import type { TenantRequest } from './tenant-request';

/**
 * Parâmetros que saem do que os guards globais já validaram — nunca do cliente.
 *
 *     list(@StoreId() storeId: string, @Query(...) query: OrdersQuery)
 *
 * em vez de `@Req() req` + `req.storeId!`. O controller deixa de conhecer o formato da
 * requisição e o `!` (que só afirmava, sem conferir) some.
 *
 * `@UserId()`, `@CompanyId()` e `@StoreId()` FALHAM se o valor não estiver lá. Isso só
 * acontece por erro de programação — rota com `@SkipTenant()` pedindo empresa, ou
 * `@StoreId()` sem `@RequireStore()` — e nesse caso um 500 visível é melhor que uma
 * consulta rodando com `null` no lugar do tenant.
 */

const requisicao = (ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest<Partial<TenantRequest>>();

function exigir<T>(valor: T | null | undefined, decorator: string, causa: string): T {
  if (valor === null || valor === undefined) {
    throw new InternalServerErrorException(`${decorator} sem valor na requisição: ${causa}`);
  }
  return valor;
}

/** Dono da sessão (`AuthGuard`). */
export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string =>
  exigir(requisicao(ctx).user?.id, '@UserId()', 'a rota é @Public ou @ServiceOnly?'),
);

/** Empresa do `X-Company-Id`, já conferida contra o usuário (`TenantGuard`). */
export const CompanyId = createParamDecorator((_: unknown, ctx: ExecutionContext): string =>
  exigir(requisicao(ctx).companyId, '@CompanyId()', 'a rota tem @SkipTenant()?'),
);

/** Loja do `X-Store-Id`, já conferida. Só em rota com `@RequireStore()`. */
export const StoreId = createParamDecorator((_: unknown, ctx: ExecutionContext): string =>
  exigir(requisicao(ctx).storeId, '@StoreId()', 'faltou @RequireStore() na rota?'),
);

/** Loja quando o header é opcional: `null` significa "a empresa inteira". */
export const OptionalStoreId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | null => requisicao(ctx).storeId ?? null,
);

/** O usuário é admin da empresa? Só é preenchido quando veio `X-Store-Id`. */
export const IsCompanyAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): boolean => requisicao(ctx).isCompanyAdmin === true,
);
