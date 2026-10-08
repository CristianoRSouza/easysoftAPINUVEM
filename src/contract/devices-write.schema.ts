import { z } from 'zod';

/**
 * Escritas de dispositivos.
 *
 * ── A regra que vale para TODAS ───────────────────────────────────────────────
 * **Nenhum destes schemas aceita `company_id` ou `store_id`.** O tenant vem do
 * `TenantGuard`, que já conferiu o vínculo no banco. Hoje o navegador manda a empresa no
 * corpo; aceitar isso deixaria o cliente escolher em nome de quem grava. Há um guard
 * (`test/tenant-write-safety.guard.spec.ts`) que quebra o build se alguém tentar.
 */

export const totemActiveSchema = z.object({
  is_active: z.boolean(),
  /**
   * Licença a vincular ao ativar. `null` explícito = desvincular; **ausente** = não mexer
   * no vínculo. A distinção importa: o gatilho do banco recusa totem ativo sem licença,
   * então "não mexer" e "desvincular" levam a resultados opostos.
   */
  license_id: z.string().uuid().nullable().optional(),
});
export type TotemActiveInput = z.infer<typeof totemActiveSchema>;

export const agentActiveSchema = z.object({ is_active: z.boolean() });
export type AgentActiveInput = z.infer<typeof agentActiveSchema>;

/**
 * Credenciais do PIXnoPDV.
 *
 * ⚠️ **A PRESENÇA da chave decide, não o valor.** Campo ausente = mantém o que está
 * gravado; campo presente com string vazia = **apaga**. É a semântica que o
 * `mergePixnopdvStorePut` do Manager-Web já usa (`hasOwnProperty`), e ela existe por um
 * motivo concreto: a tela nunca recebe o segredo de volta (só o booleano `_set`), então
 * salvar a tela inteira sem essa regra mandaria `basic_token: ""` e **apagaria a
 * credencial em produção** sem ninguém pedir.
 *
 * Por isso todos os campos são `.optional()` — e o service usa `in` para distinguir
 * "não veio" de "veio vazio". Trocar `optional()` por `nullable()` com default quebraria
 * exatamente essa distinção.
 */
export const pixnopdvPutSchema = z
  .object({
    api_base_url: z.string().nullable().optional(),
    basic_user: z.string().nullable().optional(),
    basic_token: z.string().nullable().optional(),
    secret_key: z.string().nullable().optional(),
    insecure_tls: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type PixnopdvPutInput = z.infer<typeof pixnopdvPutSchema>;
