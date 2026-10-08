import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard de fronteira de billing (EasyML §10/§12.6).
 *
 * Decisão registrada: a EasyFood API é CLIENTE do billing — LÊ crédito/licença e
 * aplica enforcement, mas NUNCA processa pagamento, fala com o Stripe, escreve na
 * base de billing, nem invoca edge functions. Este teste QUEBRA O BUILD se alguém
 * trouxer o billing pra dentro no futuro.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

// Remove comentários /* */ e // (sem comer o "//" de URLs http://) antes de varrer.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const files = walk(SRC);
const rel = (f: string) => relative(SRC, f).replace(/\\/g, '/');
const scan = (re: RegExp): string[] =>
  files.filter((f) => re.test(stripComments(readFileSync(f, 'utf8')))).map(rel);

describe('Fronteira de billing — EasyFood API é CLIENTE do billing (EasyML §10/§12.6)', () => {
  it('sanidade: varreu o código-fonte (não é no-op)', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('não importa SDK de pagamento (stripe)', () => {
    expect(scan(/from\s+['"]stripe['"]|require\(\s*['"]stripe['"]\s*\)/)).toEqual([]);
  });

  it('não contém identificadores do Stripe (price_/acct_/whsec_/pk_)', () => {
    expect(
      scan(/\b(?:price_1[A-Za-z0-9]{6,}|acct_[A-Za-z0-9]{6,}|whsec_[A-Za-z0-9]{6,}|pk_(?:live|test)_[A-Za-z0-9]{6,})\b/),
    ).toEqual([]);
  });

  /**
   * Escrita em `billing.*` — permitida SÓ no histórico de conversas.
   *
   * ── A distinção, que não é jurídica e sim prática ─────────────────────────────
   * COBRAR é decidir preço, emitir licença, contar cota, debitar crédito. Tudo isso é do
   * EasyBilling e fica fora daqui — inclusive a MEDIÇÃO do consumo de IA, que é o insumo
   * direto da cobrança.
   *
   * ⚠️ Esta lista já teve `usage_log` e `credit_transactions`, quando o assistente era
   * implementado nesta API. Duraram pouco e custaram caro de raciocinar: eram as MESMAS
   * tabelas que o EasyBilling escreve, ou seja, duas réguas cobrando da mesma carteira —
   * o mesmo cliente pagava diferente conforme o produto por onde entrasse. O ADR-0003
   * tirou a IA daqui, e elas saíram junto.
   *
   * O que sobra é `ai_chat_sessions`: o histórico da conversa. Ele é dado do PRODUTO
   * (a tela mostra o que a equipe perguntou), não insumo de cobrança.
   *
   * A allowlist é por TABELA, não por arquivo: um `insert into billing.usage_log` dentro
   * do módulo de IA reprova, esteja onde estiver.
   */
  const TABELAS_DE_MEDICAO = new Set([
    'billing.ai_chat_sessions', // histórico da conversa (dado do produto, não cobrança)
  ]);

  it('só escreve no histórico de conversas (cobrança e medição são do EasyBilling)', () => {
    const re = /\b(?:insert\s+into|update|delete\s+from)\s+(billing\.[a-z_][\w]*)/gi;
    const violacoes: string[] = [];

    for (const f of files) {
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(re)) {
        const tabela = m[1].toLowerCase();
        if (!TABELAS_DE_MEDICAO.has(tabela)) violacoes.push(`${rel(f)} → escreve em ${tabela}`);
      }
    }

    expect(
      violacoes,
      'Escrita em billing fora das tabelas de medição. Quem cobra é o EasyBilling — ' +
        'leia daqui e mande o usuário ao portal dele.\n' + violacoes.join('\n'),
    ).toEqual([]);
  });

  it('a lista de tabelas liberadas não cresceu sem alguém reparar', () => {
    // O pedágio: liberar mais uma tabela de billing para escrita exige mexer AQUI, e quem
    // revisar o diff vê a linha mudando. Foi assim que `usage_log` e `credit_transactions`
    // entraram — e o número mudando é o que teria feito alguém perguntar "por quê?".
    expect(TABELAS_DE_MEDICAO.size, 'nova tabela de billing liberada para escrita').toBe(1);
  });

  it('não guarda chave de provedor de IA (a credencial é do EasyBilling)', () => {
    // Invariante 1 do ADR-0003. O nome da variável é o rastro mais fácil de achar: se
    // `OPENAI_API_KEY` reaparecer neste código, é porque a IA voltou a ser implementada aqui.
    expect(scan(/\bOPENAI_API_KEY\b|\bAI_GATEWAY_URL\b/)).toEqual([]);
  });

  it('não chama provedor de IA direto (invariante 2 do ADR-0003)', () => {
    expect(scan(/api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com/i)).toEqual(
      [],
    );
  });

  it('não invoca edge functions (functions.invoke)', () => {
    expect(scan(/\.functions\s*\.\s*invoke\s*\(/)).toEqual([]);
  });
});
