import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { IS_PUBLIC, IS_SERVICE_ONLY } from '../src/common/decorators';
import { buildIdentity } from '../src/modules/health/application/build-identity';
import { HealthController } from '../src/modules/health/http/health.controller';

describe('GET /health/build — identidade da imagem para conferir a promoção hom -> main', () => {
  it('devolve o BUILD_ID gravado na imagem', () => {
    expect(buildIdentity({ BUILD_ID: 't-ca24c93d98f8dc29e8895f9cbff56888e721aa0a' })).toBe(
      't-ca24c93d98f8dc29e8895f9cbff56888e721aa0a',
    );
  });

  it('fora do Docker (sem BUILD_ID, vazio ou só espaço) responde dev', () => {
    expect(buildIdentity({})).toBe('dev');
    expect(buildIdentity({ BUILD_ID: '' })).toBe('dev');
    expect(buildIdentity({ BUILD_ID: '   ' })).toBe('dev');
  });

  it('a rota devolve só a identidade, nada além', () => {
    const out = new HealthController().build();
    expect(Object.keys(out)).toEqual(['build']);
  });

  // O /health promete não vazar versão em rota pública. Se alguém trocar o decorator
  // por @Public "para facilitar o teste", a versão passa a ser exposta a qualquer um.
  it('exige X-Service-Key e NÃO é pública', () => {
    const handler = HealthController.prototype.build;
    expect(Reflect.getMetadata(IS_SERVICE_ONLY, handler)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC, handler)).toBeUndefined();
  });

  it('o /health/live continua público e sem versão', () => {
    const handler = HealthController.prototype.live;
    expect(Reflect.getMetadata(IS_PUBLIC, handler)).toBe(true);
    expect(new HealthController().live()).toEqual({ status: 'ok' });
  });
});
