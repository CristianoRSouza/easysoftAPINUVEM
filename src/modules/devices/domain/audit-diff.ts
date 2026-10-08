/**
 * O que a auditoria de uma EDIÇÃO registra: só o que mudou de fato, com o de/para.
 *
 * A comparação é por `JSON.stringify` porque há campo que é lista/objeto (jsonb), e
 * ausência dos dois lados conta como igual — `undefined` e `null` são "sem valor".
 */
export interface DiffDeAuditoria {
  mudou: string[];
  de: Record<string, unknown>;
  para: Record<string, unknown>;
}

export function diffDeAuditoria(
  campos: readonly string[],
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
): DiffDeAuditoria {
  const mudou = campos.filter(
    (k) => JSON.stringify(antes[k] ?? null) !== JSON.stringify(depois[k] ?? null),
  );
  const de: Record<string, unknown> = {};
  const para: Record<string, unknown> = {};
  for (const k of mudou) {
    de[k] = antes[k] ?? null;
    para[k] = depois[k] ?? null;
  }
  return { mudou, de, para };
}
