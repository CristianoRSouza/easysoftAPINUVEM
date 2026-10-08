import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public, ServiceOnly } from '../../../common/decorators';
import { buildIdentity } from '../application/build-identity';
import { DocBuild, DocHealth, DocLive } from './health.docs';

@ApiTags('Health')
@Controller()
export class HealthController {
  /**
   * Liveness — NUNCA depende de PG/Supabase (EasyML "nunca fazer"): responde 200
   * sempre que o processo aceita requisições, para o orquestrador não dar rollback.
   */
  @Public()
  @Get('health/live')
  @DocLive()
  live() {
    return { status: 'ok' };
  }

  /** Health público mínimo: só liveness. Métrica interna (contadores) não vaza aqui. */
  @Public()
  @Get('health')
  @DocHealth()
  health() {
    return { status: 'ok' };
  }

  /**
   * Qual imagem está rodando — para conferir a promoção hom -> main. NÃO é pública: o
   * `/health` promete não vazar versão, então esta rota exige a `X-Service-Key`.
   */
  @ServiceOnly()
  @Get('health/build')
  @DocBuild()
  build() {
    return { build: buildIdentity() };
  }
}
