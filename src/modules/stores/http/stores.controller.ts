import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipTenant } from '../../../common/decorators';
import { UserId } from '../../../common/http/request.decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiSessionAuth } from '../../../common/swagger';
import { StoresService } from '../application/stores.service';
import { bootstrapCodeSchema, type BootstrapCodeInput } from '../dto/bootstrap-code.schema';
import { DocBootstrapCode } from './stores.docs';

/** Exige sessão + ser admin da loja (checado no service). Migra issue-bootstrap-code. */
@ApiTags('Lojas')
@ApiSessionAuth()
// Recebe o storeId no PATH e já checa is_company_admin_for_store no service — contrato
// anterior ao guard, mantido intacto de propósito (o cliente é o Manager em produção).
@SkipTenant()
@Controller('stores')
export class StoresController {
  constructor(private readonly service: StoresService) {}

  @Post(':storeId/bootstrap-code')
  @HttpCode(200)
  @DocBootstrapCode()
  bootstrap(
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(bootstrapCodeSchema)) body: BootstrapCodeInput,
    @UserId() userId: string,
  ) {
    return this.service.issueBootstrapCode(userId, storeId, body.email, body.ttl_hours);
  }
}
