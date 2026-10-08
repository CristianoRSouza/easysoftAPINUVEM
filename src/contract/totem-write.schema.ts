import { z } from 'zod';

/**
 * Criação e edição da configuração de totem.
 *
 * ── Onde o vínculo de licença NÃO está ────────────────────────────────────────
 * O navegador vincula a licença com um `update` direto em `billing.device_licenses`. Aqui
 * isso **não acontece**, por dois motivos que se somam:
 *
 *   1. A fronteira: a EasyFood API é **cliente** do billing (EasyML §10) — lê licença e
 *      aplica enforcement, mas não escreve. Há um guard que quebra o build.
 *   2. Não precisa: a RPC `cloud_set_totem_active(p_totem_id, p_is_active, p_license_id)`
 *      já faz o vínculo **dentro do banco**, e com um cuidado que o navegador não tem —
 *      vincula a nova licença ANTES de soltar a antiga, para o gatilho de "sem licença
 *      ativa" não desligar o totem no meio da troca.
 *
 * Consequência prática, e é uma **mudança de comportamento** que vale saber: a RPC só
 * vincula quando ATIVA (`p_is_active => true`); ao desativar ela desvincula tudo. Então
 * escolher licença num totem que fica inativo não grava vínculo nenhum — o vínculo passa
 * a acontecer no momento de ativar. Como a licença só importa com o totem ativo, o efeito
 * visível é nenhum; o que muda é o instante em que a linha do billing é escrita.
 *
 * `license_id` **é aceito aqui**, mas só para a regra de licença decidir (leitura). Quem
 * vincula é `PATCH /totems/:id/active`.
 *
 * ── Segredos TEF: estado triplo ───────────────────────────────────────────────
 * `aditum_partner_token` e `aditum_activation_code` seguem a MESMA regra do PIXnoPDV —
 * **a presença da chave decide**:
 *   • ausente          → mantém o cifrado que está gravado
 *   • presente `null`  → limpa
 *   • presente c/ texto → cifra o novo valor (envelope `enc:v1`)
 *
 * ⚠️ Isto é uma MELHORIA deliberada sobre o navegador. Lá a regra é "campo vazio + havia
 * valor antes = manter", o que torna **impossível limpar um segredo TEF pela tela**: uma
 * vez gravado, não sai. Aqui limpar é possível, mas exige dizer `null` explicitamente —
 * salvar o formulário sem tocar no campo continua preservando, que é o comportamento que
 * ninguém pode perder.
 */

const texto = (max: number) => z.string().max(max).nullable().optional();
const inteiro = (max: number) => z.number().int().min(0).max(max).optional();

const camposEditaveis = {
  is_active: z.boolean().optional(),

  // Modo de operação — os três gatilhos da regra de licença (ver totem-license.rule.ts).
  app_mode: z.enum(['demo', 'homologacao', 'producao']).optional(),
  payment_environment: z.enum(['homologacao', 'producao']).optional(),
  /** `1` = produção na SEFAZ, `2` = homologação. */
  nfce_environment: z.number().int().min(1).max(2).nullable().optional(),
  nfce_serie: z.number().int().min(0).max(999).nullable().optional(),

  // NFC-e / TEF / PIX — endereços e ajustes.
  nfce_service_url: texto(500),
  nfce_service_api_key: texto(500),
  nfce_emit_timeout_ms: inteiro(600_000),
  tef_http_base_url: texto(500),
  tef_http_api_key: texto(500),
  tef_base_url: texto(500),
  tef_insecure_tls: z.boolean().optional(),
  establishment_cnpj: texto(20),
  tef_application_name: texto(120),
  tef_application_version: texto(40),
  tef_contactless: z.boolean().optional(),
  tef_poll_interval_ms: inteiro(600_000),
  tef_poll_max_ms: inteiro(3_600_000),
  tef_credit_installment_type: texto(40),
  tef_confirm_after_charge: z.boolean().optional(),
  tef_claim_source_statuses: texto(200),
  tef_enable_worker_pending_job: z.boolean().optional(),
  pix_http_base_url: texto(500),
  pix_http_api_key: texto(500),

  payment_credit_enabled: z.boolean().optional(),
  payment_debit_enabled: z.boolean().optional(),
  payment_pix_enabled: z.boolean().optional(),
  payment_voucher_enabled: z.boolean().optional(),
  /** meal = Vale Refeição (tPag 11), food = Vale Alimentação (tPag 10). */
  payment_voucher_kind: z.enum(['meal', 'food']).optional(),

  // Impressora.
  printer_enabled: z.boolean().optional(),
  printer_model: texto(80),
  printer_port: texto(80),
  printer_code_page: inteiro(9999),
  printer_cols_normal: inteiro(200),
  printer_cut_paper: z.boolean().optional(),
  /** Inteiro no banco (`integer not null default 0`) e `number` na tela. Já foi `texto(40)`,
   *  e todo PATCH vindo da tela voltava 400 — o formulário manda o valor que leu. */
  printer_cut_type: inteiro(9),
  printer_translate_tags: z.boolean().optional(),
  printer_ignore_tags: z.boolean().optional(),
  printer_verify: z.boolean().optional(),
  printer_line_feed_after: inteiro(50),
  printer_copies: inteiro(10),
  printer_timeout_ms: inteiro(600_000),

  image_server_host: texto(200),
  image_server_port: inteiro(65_535),
} as const;

/** Segredos TEF — tratados à parte porque passam pela cifra, não vão crus ao banco. */
const segredosTef = {
  aditum_partner_token: z.string().nullable().optional(),
  aditum_activation_code: z.string().nullable().optional(),
} as const;

/** Só para a regra decidir — não vincula. Quem vincula é `PATCH /totems/:id/active`. */
const licencaParaRegra = {
  license_id: z.string().uuid().nullable().optional(),
} as const;

export const totemCreateSchema = z
  .object({
    totem_name: z.string().trim().min(1).max(120),
    ...camposEditaveis,
    ...segredosTef,
    ...licencaParaRegra,
  })
  .strict();
export type TotemCreateInput = z.infer<typeof totemCreateSchema>;

/**
 * Na edição o nome **entra**: ao contrário do agente, o totem pode ser renomeado — o
 * dispositivo se identifica pela licença e pelo id, não pelo nome.
 */
export const totemUpdateSchema = z
  .object({
    totem_name: z.string().trim().min(1).max(120).optional(),
    ...camposEditaveis,
    ...segredosTef,
    ...licencaParaRegra,
  })
  .strict();
export type TotemUpdateInput = z.infer<typeof totemUpdateSchema>;

/**
 * Ordem estável para montar `INSERT`/`UPDATE` sem depender de `Object.keys` do payload.
 *
 * `is_active` sai fora: quem liga e desliga totem é a RPC, que vincula a licença junto.
 * Gravar `is_active` direto na tabela furaria o gatilho que exige licença no totem ativo.
 */
export const TOTEM_WRITABLE_KEYS = (
  Object.keys(camposEditaveis) as ReadonlyArray<keyof typeof camposEditaveis>
).filter((k) => k !== 'is_active');

/** Os dois segredos, na ordem em que viram par `<campo>_encrypted` / `<campo>_kid`. */
export const TOTEM_TEF_SECRETS = [
  { entrada: 'aditum_partner_token', enc: 'aditum_partner_token_encrypted', kid: 'aditum_partner_token_kid' },
  { entrada: 'aditum_activation_code', enc: 'aditum_activation_code_encrypted', kid: 'aditum_activation_code_kid' },
] as const;
