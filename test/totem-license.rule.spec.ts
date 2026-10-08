import { describe, expect, it } from 'vitest';
import {
  camposDeProducao,
  configPermitida,
  ehLicencaDemo,
  pedeProducao,
} from '../src/modules/devices/domain/totem-license.rule';

/**
 * A regra que impede uma instalação de teste de emitir nota fiscal de verdade.
 * Errar aqui não dá erro na tela — dá documento fiscal real saindo de um totem demo.
 */
describe('Regra de licença do totem — demo não opera em produção', () => {
  describe('o que conta como demo', () => {
    it('plan_slug ecp-demo é demo', () => {
      expect(ehLicencaDemo({ plan_slug: 'ecp-demo', license_type: 'yearly' })).toBe(true);
    });

    it('plan_slug preenchido (outro) NÃO é demo, mesmo com license_type monthly', () => {
      // A ordem importa: sem esta precedência, licença paga mensal seria tratada como
      // demo e bloquearia produção sem motivo.
      expect(ehLicencaDemo({ plan_slug: 'pro', license_type: 'monthly' })).toBe(false);
    });

    it('sem plano: monthly, trial, demo e vazio contam como demo', () => {
      for (const t of ['monthly', 'trial', 'demo', '', null]) {
        expect(ehLicencaDemo({ plan_slug: null, license_type: t }), `tipo=${t}`).toBe(true);
      }
    });

    it('sem plano, tipo específico NÃO é demo', () => {
      expect(ehLicencaDemo({ plan_slug: null, license_type: 'yearly' })).toBe(false);
      expect(ehLicencaDemo({ plan_slug: null, license_type: 'Plano Enterprise' })).toBe(false);
    });

    it('espaços não enganam a regra', () => {
      expect(ehLicencaDemo({ plan_slug: '  ecp-demo  ', license_type: null })).toBe(true);
      expect(ehLicencaDemo({ plan_slug: null, license_type: '  MONTHLY ' })).toBe(true);
    });

    it('licença ausente é tratada como demo', () => {
      expect(ehLicencaDemo(null)).toBe(true);
      expect(ehLicencaDemo(undefined)).toBe(true);
    });
  });

  describe('os três gatilhos de produção', () => {
    it('app_mode producao', () => {
      expect(pedeProducao({ app_mode: 'producao' })).toBe(true);
    });

    it('payment_environment producao — a maquininha cobra de verdade', () => {
      expect(pedeProducao({ payment_environment: 'producao' })).toBe(true);
    });

    it('nfce_environment 1 — a nota vai para a SEFAZ de produção', () => {
      expect(pedeProducao({ nfce_environment: 1 })).toBe(true);
      expect(pedeProducao({ nfce_environment: 2 })).toBe(false);
    });

    it('o default de cada campo é o lado seguro', () => {
      expect(pedeProducao({})).toBe(false);
      expect(pedeProducao({ app_mode: 'demo', payment_environment: 'homologacao' })).toBe(false);
      expect(pedeProducao({ app_mode: null, nfce_environment: null })).toBe(false);
    });

    it('valor desconhecido não vira produção por acidente', () => {
      expect(pedeProducao({ app_mode: 'PRODUCAO' })).toBe(false);
      expect(pedeProducao({ nfce_environment: 99 })).toBe(false);
    });

    it('a mensagem sabe QUAIS campos barraram', () => {
      expect(camposDeProducao({ app_mode: 'producao', nfce_environment: 1 })).toEqual([
        'app_mode',
        'nfce_environment',
      ]);
    });
  });

  describe('a decisão', () => {
    const DEMO = { plan_slug: 'ecp-demo', license_type: null };
    const REAL = { plan_slug: 'pro', license_type: 'yearly' };

    it('demo + produção = bloqueado, e diz quais campos', () => {
      const r = configPermitida({ app_mode: 'producao' }, DEMO, false);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.campos).toEqual(['app_mode']);
        expect(r.error).toMatch(/demo/i);
      }
    });

    it('demo + homologação = permitido (o uso normal de uma demo)', () => {
      expect(configPermitida({ app_mode: 'demo', nfce_environment: 2 }, DEMO, false).ok).toBe(true);
    });

    it('licença real + produção = permitido', () => {
      expect(configPermitida({ app_mode: 'producao' }, REAL, false).ok).toBe(true);
    });

    it('totem NOVO sem licença não nasce em produção', () => {
      // Na dúvida, não emitir nota real.
      expect(configPermitida({ app_mode: 'producao' }, null, true).ok).toBe(false);
    });

    it('totem EXISTENTE sem licença encontrada não é bloqueado', () => {
      // Mantém o comportamento de hoje: só o totem novo assume demo por omissão.
      expect(configPermitida({ app_mode: 'producao' }, null, false).ok).toBe(true);
    });

    it('basta UM campo pedir produção para a regra valer', () => {
      expect(configPermitida({ nfce_environment: 1 }, DEMO, false).ok).toBe(false);
      expect(configPermitida({ payment_environment: 'producao' }, DEMO, false).ok).toBe(false);
    });
  });
});
