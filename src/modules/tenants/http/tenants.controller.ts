import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ServiceOnly } from '../../../common/decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { TenantsService } from '../application/tenants.service';
import { provisionSchema, type ProvisionInput } from '../dto/provision.schema';
import { DocProvision } from './tenants.docs';

/** Rota fina: valida o body e delega ao service. Sem regra de negócio aqui (EasyML §13). */
@ApiTags('Tenants (máquina-a-máquina)')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly service: TenantsService) {}

  /** Máquina-a-máquina (X-Service-Key): chamado pelo Sync-PG-SB, não pelo browser. */
  @ServiceOnly()
  @Post('provision')
  @HttpCode(200)
  @DocProvision()
  provision(@Body(new ZodValidationPipe(provisionSchema)) body: ProvisionInput) {
    return this.service.provision(body);
  }
}
