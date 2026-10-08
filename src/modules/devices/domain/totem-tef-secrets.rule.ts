import {
  TOTEM_TEF_SECRETS,
  type TotemCreateInput,
  type TotemUpdateInput,
} from '../../../contract/totem-write.schema';

/** O par que vai para o banco no lugar do segredo em claro. */
export interface SegredoCifrado {
  cifrado: string;
  kid: string;
}

/** Colunas e valores dos segredos TEF, na ordem em que entram no comando. */
export interface SegredosTefParaGravar {
  campos: string[];
  valores: unknown[];
}

/**
 * Os segredos TEF, prontos para gravar — **a presença da chave decide**.
 *
 *   • chave ausente          → não entra no comando: mantém o cifrado que está gravado
 *   • chave presente `null`  → grava `null`: limpa
 *   • chave presente c/ texto → cifra e grava, junto com o `kid` da chave mestra
 *
 * Vale a mesma advertência do PIXnoPDV: a tela **nunca** recebe o segredo de volta (só o
 * booleano `_set`). Se a regra fosse pelo VALOR e não pela presença, salvar o formulário
 * inteiro mandaria vazio e apagaria o segredo TEF em produção sem ninguém pedir — o
 * totem pararia de cobrar no cartão.
 *
 * Diferença deliberada em relação ao navegador: lá "vazio + havia valor antes" significa
 * manter, o que torna **impossível limpar um segredo pela tela**. Aqui limpar é possível,
 * mas exige dizer `null` de propósito.
 *
 * `cifrar` vem de fora porque a chave mestra é configuração do servidor: só é chamada
 * quando há texto a cifrar, e é ela que recusa quando a chave não está configurada.
 */
export function segredosTefParaGravar(
  input: TotemCreateInput | TotemUpdateInput,
  cifrar: (texto: string) => SegredoCifrado,
): SegredosTefParaGravar {
  const campos: string[] = [];
  const valores: unknown[] = [];
  const rec = input as Record<string, unknown>;

  for (const s of TOTEM_TEF_SECRETS) {
    if (!Object.prototype.hasOwnProperty.call(rec, s.entrada)) continue;
    const bruto = rec[s.entrada];
    const texto = typeof bruto === 'string' ? bruto.trim() : '';
    if (texto === '') {
      campos.push(s.enc, s.kid);
      valores.push(null, null);
    } else {
      const { cifrado, kid } = cifrar(texto);
      campos.push(s.enc, s.kid);
      valores.push(cifrado, kid);
    }
  }
  return { campos, valores };
}

/** Cópia do payload sem os segredos — auditoria não é lugar de guardar segredo. */
export function semSegredos(input: TotemCreateInput | TotemUpdateInput): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const s of TOTEM_TEF_SECRETS) {
    if (s.entrada in copia) copia[s.entrada] = '***';
  }
  return copia;
}

/** Das colunas de segredo que entram no comando, as que a auditoria nomeia (sem o `kid`). */
export const colunasCifradas = (tef: SegredosTefParaGravar): string[] =>
  tef.campos.filter((k) => k.endsWith('_encrypted'));
