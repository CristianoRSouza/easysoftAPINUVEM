/**
 * Formas do contexto do usuário e as duas regras que não dependem de banco: como os
 * papéis viram alcance e o que da linha de loja NÃO sai na resposta.
 */

export interface MeCompany {
  id: string;
  cnpj: string | null;
  name: string | null;
}

export interface MeStore {
  id: string;
  company_id: string;
  trade_name: string | null;
  legacy_store_code: string;
  store_type: string | null;
  is_default: boolean;
}

/** A linha de loja como a consulta devolve: `has_direct` é interno e não vai ao fio. */
export type MeStoreRow = MeStore & { has_direct: boolean };

export interface RoleFlags {
  isSystemAdmin: boolean;
  isCompanyAdmin: boolean;
}

export function resolveRoleFlags(roles: string[]): RoleFlags {
  const roleSet = new Set(roles);
  return {
    // `tech_admin` entra junto de `system_admin` — é o mesmo alcance na UI de hoje.
    isSystemAdmin: roleSet.has('system_admin') || roleSet.has('tech_admin'),
    isCompanyAdmin: roleSet.has('company_admin'),
  };
}

export const toMeStore = ({ has_direct: _ignored, ...store }: MeStoreRow): MeStore => store;
