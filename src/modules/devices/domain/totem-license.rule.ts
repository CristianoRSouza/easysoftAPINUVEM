/**
 * A regra de licença do totem: **demo não opera em produção**.
 *
 * No `cloud-data.ts` ela aparece como três funções separadas
 * (`assertCloudTotemAppModeAllowed`, `...PaymentEnvironmentAllowed`,
 * `...NfceEnvironmentAllowed`) que fazem exatamente a mesma pergunta com gatilhos
 * diferentes. Aqui é **uma** regra com três gatilhos — se ela mudar, muda num lugar só.
 *
 * Por que importa: um totem com licença demo emitindo NFC-e em ambiente de PRODUÇÃO
 * manda documento fiscal de verdade para a SEFAZ. Não é um limite comercial; é o que
 * impede uma instalação de teste de gerar nota real.
 */

/** Mensagem única — a tela mostra esta frase nos três casos. */
export const DEMO_BLOQUEIA_PRODUCAO =
  'Licença demo não permite operar em produção. Vincule uma licença ativa ao totem.';

export interface LicencaParaRegra {
  license_type: string | null;
  plan_slug: string | null;
}

/**
 * A licença é demo?
 *
 * A ordem importa e não é óbvia: **`plan_slug` preenchido decide sozinho**. Se houver
 * plano e ele não for `ecp-demo`, é licença real — mesmo que `license_type` seja
 * `monthly`, que na ausência de plano contaria como demo. Trocar a ordem faria licença
 * paga mensal ser tratada como demo e bloquear produção sem motivo.
 */
export function ehLicencaDemo(lic: LicencaParaRegra | null | undefined): boolean {
  const slug = lic?.plan_slug?.trim();
  if (slug === 'ecp-demo') return true;
  if (slug) return false;
  const tipo = (lic?.license_type ?? '').trim().toLowerCase();
  return !tipo || tipo === 'monthly' || tipo === 'trial' || tipo === 'demo';
}

export interface ConfigParaRegra {
  app_mode?: string | null;
  payment_environment?: string | null;
  /** `1` = produção na SEFAZ; `2` = homologação. */
  nfce_environment?: number | null;
}

/**
 * Algum campo da configuração pede PRODUÇÃO?
 *
 * Os três gatilhos, e o que cada um significa na prática:
 *   • `app_mode = 'producao'` — o totem sai do modo de demonstração e vende de verdade;
 *   • `payment_environment = 'producao'` — a maquininha cobra de verdade;
 *   • `nfce_environment = 1` — a nota vai para o ambiente de produção da SEFAZ.
 *
 * O default de cada um é o lado seguro: o que não vier explicitamente como produção é
 * tratado como homologação/demo.
 */
export function pedeProducao(cfg: ConfigParaRegra): boolean {
  if (cfg.app_mode === 'producao') return true;
  if (cfg.payment_environment === 'producao') return true;
  if (cfg.nfce_environment != null && Number(cfg.nfce_environment) === 1) return true;
  return false;
}

/** Quais campos pediram produção — para a mensagem dizer o que exatamente barrou. */
export function camposDeProducao(cfg: ConfigParaRegra): string[] {
  const out: string[] = [];
  if (cfg.app_mode === 'producao') out.push('app_mode');
  if (cfg.payment_environment === 'producao') out.push('payment_environment');
  if (cfg.nfce_environment != null && Number(cfg.nfce_environment) === 1) {
    out.push('nfce_environment');
  }
  return out;
}

/**
 * A configuração é permitida?
 *
 * `licenca` é a que vale para a decisão: a informada explicitamente, ou a já vinculada ao
 * totem. **`null` para totem NOVO conta como demo** — totem sem licença não nasce em
 * produção. É o mesmo default conservador do navegador (`isNewTotem`), e é o certo: na
 * dúvida, não emitir nota real.
 */
export function configPermitida(
  cfg: ConfigParaRegra,
  licenca: LicencaParaRegra | null,
  ehTotemNovo: boolean,
): { ok: true } | { ok: false; error: string; campos: string[] } {
  if (!pedeProducao(cfg)) return { ok: true };

  const demo = licenca == null ? ehTotemNovo : ehLicencaDemo(licenca);
  if (!demo) return { ok: true };

  return { ok: false, error: DEMO_BLOQUEIA_PRODUCAO, campos: camposDeProducao(cfg) };
}
