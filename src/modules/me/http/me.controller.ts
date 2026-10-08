import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipTenant } from '../../../common/decorators';
import { CompanyId, UserId } from '../../../common/http/request.decorators';
import { ApiSessionAuth } from '../../../common/swagger';
import { MeService } from '../application/me.service';
import { DocAllStores, DocContext, DocStores } from './me.docs';

/**
 * Contexto multi-tenant do usuário logado.
 *
 * As duas rotas têm posturas DIFERENTES de propósito:
 *   • `/me/context` é `@SkipTenant()` — é ela que diz QUAIS empresas existem para o
 *     usuário. Exigir `X-Company-Id` aqui seria circular: o cliente ainda não sabe o
 *     que pode escolher.
 *   • `/me/stores` passa pelo `TenantGuard` normalmente — a essa altura a empresa já
 *     foi escolhida e precisa ser conferida como em qualquer outra rota de dado.
 */
@ApiTags('Contexto do usuário')
@ApiSessionAuth()
@Controller('me')
export class MeController {
  constructor(private readonly service: MeService) {}

  @SkipTenant()
  @Get('context')
  @DocContext()
  context(@UserId() userId: string) {
    return this.service.context(userId);
  }

  @Get('stores')
  @DocStores()
  stores(@UserId() userId: string, @CompanyId() companyId: string) {
    return this.service.stores(userId, companyId);
  }

  @Get('all-stores')
  @SkipTenant()
  @DocAllStores()
  allStores(@UserId() userId: string) {
    return this.service.allStores(userId);
  }
}
