import { describe, expect, it } from 'vitest';
import { resolveRoleFlags, toMeStore } from '../src/modules/me/domain/me.mapper';

describe('resolveRoleFlags — papéis viram alcance', () => {
  it('sem papel nenhum: nem system nem company admin', () => {
    expect(resolveRoleFlags([])).toEqual({ isSystemAdmin: false, isCompanyAdmin: false });
  });

  it('system_admin e tech_admin têm o mesmo alcance', () => {
    expect(resolveRoleFlags(['system_admin']).isSystemAdmin).toBe(true);
    expect(resolveRoleFlags(['tech_admin']).isSystemAdmin).toBe(true);
  });

  it('company_admin NÃO vira system_admin', () => {
    expect(resolveRoleFlags(['company_admin'])).toEqual({ isSystemAdmin: false, isCompanyAdmin: true });
  });

  it('os dois papéis juntos ligam as duas marcas', () => {
    expect(resolveRoleFlags(['company_admin', 'tech_admin'])).toEqual({
      isSystemAdmin: true,
      isCompanyAdmin: true,
    });
  });

  it('papel desconhecido não concede nada', () => {
    expect(resolveRoleFlags(['store_user', 'SYSTEM_ADMIN'])).toEqual({
      isSystemAdmin: false,
      isCompanyAdmin: false,
    });
  });
});

describe('toMeStore — o campo interno não vai ao fio', () => {
  it('tira has_direct e mantém o resto como veio', () => {
    const row = {
      id: 's1',
      company_id: 'c1',
      trade_name: null,
      legacy_store_code: '1',
      store_type: 'headquarters',
      is_default: true,
      has_direct: false,
    };
    expect(toMeStore(row)).toEqual({
      id: 's1',
      company_id: 'c1',
      trade_name: null,
      legacy_store_code: '1',
      store_type: 'headquarters',
      is_default: true,
    });
  });
});
