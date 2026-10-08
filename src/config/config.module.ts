import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './env';

/** Disponibiliza o ENV validado para toda a aplicação (injeção via @Inject(ENV)). */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
