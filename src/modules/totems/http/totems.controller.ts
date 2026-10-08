import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipTenant } from '../../../common/decorators';
import { UserId } from '../../../common/http/request.decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiSessionAuth } from '../../../common/swagger';
import { TotemsService } from '../application/totems.service';
import { encryptTefSchema, type EncryptTefInput } from '../dto/encrypt-tef.schema';
import { DocEncryptTefSecrets } from './totems.docs';

/** Exige sessão + ser admin da loja (checado no service). Migra encrypt-totem-tef-secrets. */
@ApiTags('Totens')
@ApiSessionAuth()
// Recebe o store_id no BODY e já checa is_company_admin_for_store no service — contrato
// anterior ao guard, mantido intacto de propósito (o cliente é o Manager em produção).
@SkipTenant()
@Controller('totems')
export class TotemsController {
  constructor(private readonly service: TotemsService) {}

  @Post('tef-secrets/encrypt')
  @HttpCode(200)
  @DocEncryptTefSecrets()
  encrypt(
    @Body(new ZodValidationPipe(encryptTefSchema)) body: EncryptTefInput,
    @UserId() userId: string,
  ) {
    return this.service.encryptTefSecrets(userId, body.store_id, body.partner_token, body.ativation_code);
  }
}
