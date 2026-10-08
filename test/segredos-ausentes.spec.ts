import { describe, expect, it } from 'vitest';
import { segredosAusentes } from '../src/config/env';
import type { Env } from '../src/config/env';

const env = (over: Partial<Env> = {}) =>
  ({
    SSO_SHARED_SECRET_EASYFOOD: '',
    SSO_SHARED_SECRET: '',
    ERROR_REPORT_SECRET_EASYFOOD: '',
    ERROR_REPORT_SECRET: '',
    SENSITIVE_SECRET_MASTER_KEY_BASE64: '',
    AI_SERVICE_SHARED_SECRET: '',
    ...over,
  }) as Env;

const juntou = (e: Env) => segredosAusentes(e).join(' | ');

describe('segredosAusentes — o aviso de arranque que faltou em 31/07/2026', () => {
  it('cofre vazio: nomeia as quatro funcionalidades que ficam desligadas', () => {
    const out = segredosAusentes(env());
    expect(out).toHaveLength(4);
    expect(juntou(env())).toMatch(/Suporte/);
    expect(juntou(env())).toMatch(/telemetria/);
    // O assistente de IA entrou nesta lista com a migração da edge `ai-chat`. O segredo
    // mudou de natureza (não é mais chave de provedor, e sim o compartilhado que assina o
    // token de serviço para o EasyBilling), mas o sintoma é o mesmo: sem ele a rota de chat
    // responde 503 e a tela mostra erro genérico — o "sumiu sem avisar" que isto previne.
    expect(juntou(env())).toMatch(/assistente de IA/i);
  });

  it('SSO: qualquer uma das duas chaves basta — a dedicada OU a legada', () => {
    expect(juntou(env({ SSO_SHARED_SECRET_EASYFOOD: 'x' }))).not.toMatch(/SSO_/);
    expect(juntou(env({ SSO_SHARED_SECRET: 'x' }))).not.toMatch(/SSO_/);
  });

  it('telemetria: a dedicada do EasyFood OU a compartilhada satisfazem o aviso', () => {
    expect(juntou(env({ ERROR_REPORT_SECRET_EASYFOOD: 'x' }))).not.toMatch(/ERROR_REPORT/);
    expect(juntou(env({ ERROR_REPORT_SECRET: 'x' }))).not.toMatch(/ERROR_REPORT/);
  });

  it('cofre completo: nada a avisar (o silêncio no boot precisa significar "está tudo lá")', () => {
    expect(
      segredosAusentes(
        env({
          SSO_SHARED_SECRET_EASYFOOD: 'x',
          ERROR_REPORT_SECRET_EASYFOOD: 'y',
          SENSITIVE_SECRET_MASTER_KEY_BASE64: 'z',
          AI_SERVICE_SHARED_SECRET: 'w',
        }),
      ),
    ).toEqual([]);
  });

  it('nunca vaza valor de segredo no texto do aviso', () => {
    const texto = juntou(env({ SSO_SHARED_SECRET: '', ERROR_REPORT_SECRET: '' }));
    expect(texto).not.toMatch(/=/); // nomes e rótulos, nunca `CHAVE=valor`
  });
});
