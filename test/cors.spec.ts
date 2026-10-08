import { describe, expect, it } from 'vitest';
import { resolveCors } from '../src/bootstrap/cors';

/**
 * A regra que este teste protege: origem liberada para qualquer um e cookie de sessão
 * NUNCA andam juntos. Refletir a origem com `credentials: true` deixaria qualquer site
 * fazer requisição autenticada em nome de quem está logado no Manager.
 */
describe('resolveCors — curinga nunca leva credenciais', () => {
  it('"*" libera a origem e DESLIGA as credenciais', () => {
    expect(resolveCors('*')).toEqual({
      wildcard: true,
      options: { origin: true, credentials: false },
    });
  });

  it('vazio (ou só vírgulas e espaços) é tratado como curinga', () => {
    expect(resolveCors('').wildcard).toBe(true);
    expect(resolveCors(' , ,').options).toEqual({ origin: true, credentials: false });
  });

  it('allowlist explícita liga as credenciais só para ela', () => {
    expect(resolveCors('https://a.exemplo, https://b.exemplo')).toEqual({
      wildcard: false,
      options: { origin: ['https://a.exemplo', 'https://b.exemplo'], credentials: true },
    });
  });

  it('um "*" no meio da lista derruba as credenciais da lista inteira', () => {
    expect(resolveCors('https://a.exemplo,*').options).toEqual({ origin: true, credentials: false });
  });
});
