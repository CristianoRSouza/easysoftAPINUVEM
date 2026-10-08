import type { PixnopdvPutInput } from '../../../contract/devices-write.schema';

/** O que está gravado hoje, COM os segredos — só existe do lado do servidor. */
export interface PixnopdvGravado {
  api_base_url: string | null;
  basic_user: string | null;
  basic_token: string | null;
  secret_key: string | null;
  insecure_tls: boolean | null;
  enabled: boolean | null;
}

/** O que vai ser gravado, já decidido campo a campo. */
export interface PixnopdvParaGravar {
  api_base_url: string | null;
  basic_user: string | null;
  basic_token: string | null;
  secret_key: string | null;
  insecure_tls: boolean;
  enabled: boolean;
}

const texto = (v: unknown): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};

const url = (v: unknown): string | null => {
  const t = texto(v);
  return t ? t.replace(/\/+$/, '') : null;
};

/**
 * ⚠️ **A PRESENÇA da chave decide, não o valor** — a regra que evita o pior bug possível
 * desta rota. A tela nunca recebe o segredo de volta (só o booleano `_set`), então salvar
 * o formulário inteiro mandaria `basic_token: ""`. Sem esta regra, isso **apagaria a
 * credencial em produção** sem ninguém pedir, e o PIX pararia de funcionar na loja.
 *
 * Campo ausente → mantém o gravado. Campo presente com vazio → apaga (intencional).
 */
export function mesclarCredenciaisPixnopdv(
  input: PixnopdvPutInput,
  prev: PixnopdvGravado | null,
): PixnopdvParaGravar {
  const tem = (k: keyof PixnopdvPutInput) => Object.prototype.hasOwnProperty.call(input, k);
  return {
    api_base_url: tem('api_base_url') ? url(input.api_base_url) : (prev?.api_base_url ?? null),
    basic_user: tem('basic_user') ? texto(input.basic_user) : (prev?.basic_user ?? null),
    basic_token: tem('basic_token') ? texto(input.basic_token) : (prev?.basic_token ?? null),
    secret_key: tem('secret_key') ? texto(input.secret_key) : (prev?.secret_key ?? null),
    insecure_tls: tem('insecure_tls')
      ? Boolean(input.insecure_tls)
      : Boolean(prev?.insecure_tls ?? false),
    enabled: tem('enabled') ? Boolean(input.enabled) : prev == null ? true : Boolean(prev.enabled),
  };
}

/** A resposta NUNCA devolve os segredos — só se estão configurados. */
export function credenciaisPixnopdvSemSegredos(storeId: string, gravado: PixnopdvParaGravar) {
  return {
    store_id: storeId,
    environment: 'producao',
    api_base_url: gravado.api_base_url,
    basic_user: gravado.basic_user,
    basic_token_set: gravado.basic_token != null,
    secret_key_set: gravado.secret_key != null,
    insecure_tls: gravado.insecure_tls,
    enabled: gravado.enabled,
  };
}
