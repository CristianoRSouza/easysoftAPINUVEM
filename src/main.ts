import 'dotenv/config';
import 'reflect-metadata';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { resolveCors } from './bootstrap/cors';
import { setupSwagger } from './bootstrap/swagger';
import { loadEnv, segredosAusentes } from './config/env';
import { EasySoftLogger } from './common/logging/easysoft-logger';
import { criarRequestLogMiddleware } from './common/logging/request-log.middleware';

async function bootstrap() {
  const env = loadEnv(); // fail-fast: aborta o boot se o ambiente estiver inválido

  // Padrão EasySoft de Logs (docs/PADRAO-LOGS.md). Escreve na SAÍDA PADRÃO, não em
  // arquivo: quem recolhe aqui é o Docker, e arquivo dentro de contêiner some no próximo
  // deploy. O tamanho é limitado pelo `logging:` do compose.
  const logger = new EasySoftLogger({ app: 'easyfood-api' });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });

  // Corpo JSON: ver HTTP_BODY_LIMIT. Sem isto vale o default do Express (100 kb), que
  // derrubava o push do sync com 500 e travava a fila da loja inteira.
  app.useBodyParser('json', { limit: env.HTTP_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: env.HTTP_BODY_LIMIT, extended: true });

  // ANTES de tudo: cada requisição ganha um id de correlação, que sai no log e volta no
  // header `x-request-id`. É o que amarra a chamada ao log do totem e do serviço fiscal,
  // que já registram o mesmo id. @see common/logging/request-context.ts
  app.use(criarRequestLogMiddleware(logger));
  app.use(helmet());
  app.use(cookieParser());
  // Atrás de 1 proxy (Caddy/LB) em prod — pro rate-limit ler o IP real do X-Forwarded-For.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const cors = resolveCors(env.CORS_ORIGIN);
  if (cors.wildcard) {
    logger.emitir({
      level: 'warn',
      ctx: 'BOOT',
      step: 'cors',
      msg: 'CORS_ORIGIN="*": credenciais (cookies) DESABILITADAS por segurança. Defina a origem exata da SPA para sessão via cookie.',
    });
  }
  app.enableCors(cors.options);
  app.setGlobalPrefix(env.API_PREFIX);

  if (env.SWAGGER_ENABLED) setupSwagger(app, env);

  await app.listen(env.PORT);

  logger.emitir({
    level: 'info',
    ctx: 'BOOT',
    step: 'startup',
    msg: `EasyFood API no ar em :${env.PORT}/${env.API_PREFIX}`,
    data: {
      porta: env.PORT,
      prefixo: env.API_PREFIX,
      nivelDeLog: process.env.LOG_LEVEL ?? 'info',
      formatoDeLog: process.env.LOG_FORMAT ?? 'text',
      swagger: env.SWAGGER_ENABLED,
    },
  });

  // Cofre incompleto não trava o boot (dev roda sem isso), mas some com uma funcionalidade
  // inteira sem avisar ninguém — então avisa aqui, por NOME, nunca por valor.
  const faltando = segredosAusentes(env);
  if (faltando.length) {
    logger.emitir({
      level: 'warn',
      ctx: 'BOOT',
      step: 'segredos',
      msg: 'Segredos ausentes: as rotas afetadas respondem fail-closed',
      data: { faltando },
    });
  }
}

bootstrap();
