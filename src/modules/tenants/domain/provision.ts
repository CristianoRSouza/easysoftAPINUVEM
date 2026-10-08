import type { ProvisionInput } from '../dto/provision.schema';

/**
 * Formas e regras PURAS do provisionamento: como a identidade foi resolvida, que nome uma
 * loja recebe quando o payload não traz, e o que da resposta só aparece uma vez.
 */

/** Por qual caminho a empresa/loja foi identificada — o chamador (Sync-PG-SB) lê este campo. */
export type IdResolution = 'client_provided_match' | 'matched_by_cnpj' | 'newly_created';

export type StoreInput = ProvisionInput['stores'][number];

/** A empresa como vai para o banco: ausência é `null`, CNPJ já formatado. */
export interface CompanyData {
  company_id: string | null;
  cnpj: string | null;
  name: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

export interface ResolvedUser {
  user_id: string;
  email: string;
  full_name?: string;
  role?: string;
}

/** Loja pronta para persistir: usuários já resolvidos no Auth e a chave já em hash. */
export interface PreparedStore {
  input: StoreInput;
  users: ResolvedUser[];
  apiKeyHash: string;
  apiKeyPrefix: string;
}

export interface ProvisionedStore {
  store_id: string;
  legacy_store_code: number;
  cnpj: string | null;
  is_new: boolean;
  id_resolution: IdResolution;
  api_key_status: 'created' | 'existente';
  api_key_id: string;
  users: Array<{ user_id: string; email: string }>;
}

/** O que a transação devolve — ainda SEM os segredos em claro (ver `revealOneTimeSecrets`). */
export interface ProvisionResult {
  success: boolean;
  company: { company_id: string; cnpj: string | null; is_new: boolean; id_resolution: IdResolution };
  stores: ProvisionedStore[];
}

export function formatCnpj(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return cnpj;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function toCompanyData(company: ProvisionInput['company']): CompanyData {
  return {
    company_id: company.company_id ?? null,
    cnpj: company.cnpj ? formatCnpj(company.cnpj) : null,
    name: company.name ?? null,
    document: company.document ?? null,
    email: company.email ?? null,
    phone: company.phone ?? null,
    address: company.address ?? null,
    city: company.city ?? null,
    state: company.state ?? null,
  };
}

/**
 * Registro JÁ existente: bateu com o id que o cliente mandou, ou foi achado pelo CNPJ?
 * (Id informado que não existe e CNPJ que existe cai em `matched_by_cnpj`.)
 */
export function resolutionOfExisting(
  requestedId: string | null | undefined,
  foundId: string,
): IdResolution {
  return requestedId && foundId === requestedId ? 'client_provided_match' : 'matched_by_cnpj';
}

/** Nomes da loja NOVA quando o payload traz só um deles — ou nenhum. */
export function newStoreNames(st: StoreInput): { legalName: string; tradeName: string } {
  return {
    legalName: st.legal_name || st.trade_name || 'Loja',
    tradeName: st.trade_name || st.legal_name || 'Loja',
  };
}

export const apiKeyName = (st: StoreInput): string =>
  `API Key - ${st.trade_name || st.legal_name || 'Loja'}`;

/**
 * Reidrata com o que só o serviço conhece (chave em texto + senha temporária).
 *
 * `api_key` só aparece quando a chave foi criada AGORA; se já havia uma ativa vem `null` —
 * a antiga não é revelada. `temporary_password` só para usuário recém-criado no Auth.
 */
export function revealOneTimeSecrets(
  stores: ProvisionedStore[],
  cleartextKeys: string[],
  createdUsers: ReadonlyMap<string, string>,
) {
  return stores.map((s, i) => ({
    ...s,
    api_key: s.api_key_status === 'created' ? cleartextKeys[i] : null,
    users: s.users.map((us) => {
      const temp = createdUsers.get(String(us.email).toLowerCase());
      return { ...us, is_new: temp !== undefined, ...(temp ? { temporary_password: temp } : {}) };
    }),
  }));
}
