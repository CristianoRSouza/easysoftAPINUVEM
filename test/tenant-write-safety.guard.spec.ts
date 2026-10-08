import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard de ESCRITA multi-tenant — quebra o build antes de a rota existir.
 *
 * ── Por que existe ─────────────────────────────────────────────────────────────
 * Uma varredura no `cloud-data.ts` do Manager-Web (2026-07-30) achou o mesmo padrão
 * em 7 escritas:
 *
 *     .update({ ... }).eq("id", id)      // e nada mais
 *
 * No navegador isso é seguro porque a RLS do Supabase barra a linha de outra empresa.
 * **O role desta API tem `BYPASSRLS` de propósito** (ver `sql/least-privilege-role.sql`):
 * copiar esse padrão para cá deixaria qualquer usuário logado alterar a configuração do
 * totem — ou **desativar o agente de NFC-e** — de outra empresa, só passando o id dela.
 * Desativar o agente de NFC-e de um concorrente é parar a emissão de nota na loja dele.
 *
 * A regra, então, é: **toda escrita carrega o tenant no `WHERE`, não só o id.**
 *
 *     update ... where id = $1 and company_id = $2
 *
 * E o problema espelhado, no `INSERT`: hoje o payload do browser traz `company_id`. Aqui
 * o tenant vem SEMPRE da sessão (`req.companyId`, posto pelo `TenantGuard`) e **nunca** do
 * corpo da requisição — senão o cliente escolhe em nome de quem grava.
 *
 * ── Como ler uma falha ─────────────────────────────────────────────────────────
 * Se este teste quebrou, a correção quase sempre é acrescentar `and company_id = $N` ao
 * `WHERE` — não adicionar o arquivo à allowlist. A allowlist é para escrita que é
 * cross-tenant POR NATUREZA, e cada entrada tem que explicar por quê.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Colunas que provam recorte de tenant num WHERE. */
const TENANT_COLS = /\b(company_id|store_id)\b/;

/**
 * Escritas cross-tenant POR NATUREZA. Cada entrada precisa de justificativa — não é
 * lugar para "esta ainda não ajustei".
 */
const WRITE_ALLOWLIST: Record<string, string> = {
  // Sessão é do USUÁRIO, não de uma empresa: o recorte é o hash do token, e um usuário
  // pode pertencer a várias empresas. Exigir company_id aqui não faria sentido.
  'db/session.service.ts': 'sessões são por usuário/token, não por empresa',
  // Provisionamento é @ServiceOnly (X-Service-Key, chamado pelo Sync-PG-SB) e existe
  // justamente para CRIAR a empresa — não há tenant anterior a que se prender.
  'modules/tenants/infrastructure/tenants.repository.ts': '@ServiceOnly: cria a própria empresa',
  // Fila de sync é @ServiceOnly e cross-tenant por desenho (um worker drena a fila toda).
  'modules/sync/infrastructure/sync.repository.ts': '@ServiceOnly: fila global do worker de sync',
};

/**
 * DTOs que podem declarar `company_id`/`store_id` como ENTRADA.
 *
 * Duas famílias, e a diferença importa:
 *   • **@ServiceOnly** — não há sessão de usuário, então o tenant TEM que vir no corpo;
 *     quem autentica é a `X-Service-Key`.
 *   • **Alvo validado** — a rota recebe o `store_id` mas o trata como ALVO, não como
 *     credencial: checa `is_company_admin_for_store(caller, store)` ANTES de agir.
 *     Ao adicionar uma entrada assim, confirme que a checagem existe no service — sem
 *     ela, o campo vira exatamente o buraco que este guard existe para impedir.
 */
const TENANT_INPUT_ALLOWLIST: Record<string, string> = {
  'modules/tenants/dto/provision.schema.ts':
    '@ServiceOnly: é a rota que CRIA a empresa, não há tenant anterior',
  'modules/sync/dto/sync.schema.ts':
    '@ServiceOnly: o worker drena a fila de várias lojas numa chamada',
  'modules/totems/dto/encrypt-tef.schema.ts':
    'store_id é ALVO validado por is_company_admin_for_store no service (403 se não for admin)',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const files = walk(SRC).map((f) => ({ rel: relative(SRC, f).replace(/\\/g, '/'), src: readFileSync(f, 'utf8') }));

/**
 * Recorta cada comando de escrita com o seu WHERE. Pega `update <alvo> set ...` e
 * `delete from <alvo> ...` até o fim do statement (`;`, fecha-crase ou fim de linha dupla).
 */
function writeStatements(src: string): Array<{ kind: string; target: string; text: string }> {
  const out: Array<{ kind: string; target: string; text: string }> = [];
  const re = /\b(update|delete\s+from)\s+([a-zA-Z_][\w.]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // `on conflict (…) do update set …` NÃO é um UPDATE solto: é a metade de um upsert,
    // e quem o escopa é o ALVO DO CONFLITO, não um WHERE (ele não tem WHERE).
    // Então o que se cobra dele é outra coisa — que o alvo do conflito inclua o tenant —
    // e é isso que se testa aqui, em vez de mandar procurar um WHERE que não existe.
    //
    // Sem esta distinção o guard reprovava um upsert correto e a "correção" natural
    // seria pôr `company_id = excluded.company_id` no SET: uma coluna se atribuindo a si
    // mesma, só para calar o teste. Guard que induz a isso ensina a burlá-lo.
    const antes = src.slice(Math.max(0, m.index - 400), m.index);
    if (/\bdo\s+$/i.test(antes)) {
      const conflito = antes.match(/on\s+conflict\s*\(([^)]*)\)\s*do\s+$/i);
      out.push({
        kind: 'upsert',
        target: m[2],
        // Só o alvo do conflito. Se ele não nomear empresa/loja, o upsert pode casar com
        // a linha de outra empresa e sobrescrevê-la — que é exatamente o risco original.
        text: conflito ? conflito[1] : '(on conflict sem alvo)',
      });
      continue;
    }

    // Recorta até 800 chars ou até o próximo `;`/crase de fim de template.
    const rest = src.slice(m.index, m.index + 800);
    const end = rest.search(/;|`\s*,|`\s*\)/);
    out.push({
      kind: m[1].toLowerCase().startsWith('delete') ? 'delete' : 'update',
      target: m[2],
      text: end > 0 ? rest.slice(0, end) : rest,
    });
  }
  return out;
}

describe('Guard de escrita multi-tenant — o role da API tem BYPASSRLS', () => {
  it('sanidade: varreu o código-fonte (não é no-op)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('toda escrita leva company_id ou store_id no WHERE', () => {
    const violacoes: string[] = [];

    for (const { rel, src } of files) {
      if (WRITE_ALLOWLIST[rel]) continue;
      if (rel.startsWith('contract/')) continue; // contrato não executa SQL

      for (const st of writeStatements(stripComments(src))) {
        // `update` sem `set` é outra coisa (ex.: "updated_at" numa lista de colunas).
        if (st.kind === 'update' && !/\bset\b/i.test(st.text)) continue;
        // Escrita sem WHERE nenhum é pior ainda — cai aqui do mesmo jeito.
        if (TENANT_COLS.test(st.text)) continue;
        const onde = st.kind === 'upsert' ? 'no alvo do ON CONFLICT' : 'no WHERE';
        violacoes.push(
          `${rel} → ${st.kind} ${st.target} sem company_id/store_id ${onde}\n` +
            `      ${st.text.replace(/\s+/g, ' ').slice(0, 140)}`,
        );
      }
    }

    expect(
      violacoes,
      'Escrita sem recorte de tenant. Acrescente `and company_id = $N` ao WHERE — ' +
        'a allowlist é só para escrita cross-tenant por natureza (ex.: @ServiceOnly).\n' +
        violacoes.join('\n'),
    ).toEqual([]);
  });

  it('nenhum DTO aceita company_id/store_id do cliente — tenant vem da sessão', () => {
    const violacoes: string[] = [];

    for (const { rel, src } of files) {
      if (!/\/dto\/|contract\//.test(rel)) continue;
      if (TENANT_INPUT_ALLOWLIST[rel]) continue;
      const limpo = stripComments(src);
      // Campo declarado num objeto Zod: `company_id: z.` / `store_id: z.`
      for (const col of ['company_id', 'store_id']) {
        if (new RegExp(`\\b${col}\\s*:\\s*z\\.`).test(limpo)) {
          violacoes.push(`${rel} → declara "${col}" como entrada`);
        }
      }
    }

    expect(
      violacoes,
      'Tenant não pode vir do corpo da requisição — use `req.companyId`/`req.storeId`, ' +
        'que o TenantGuard preenche a partir da sessão.\n' + violacoes.join('\n'),
    ).toEqual([]);
  });

  it('o guard REPROVA um upsert cujo alvo de conflito não tem tenant', () => {
    // Guard que só passa não prova nada. Aqui se quebra de propósito: um upsert que
    // casa apenas por (user_id, day) pode sobrescrever a linha de OUTRA empresa.
    const ruim = writeStatements(
      'insert into billing.ai_chat_sessions (user_id, day) values ($1,$2) ' +
        'on conflict (user_id, day) do update set messages = excluded.messages;',
    );
    expect(ruim).toHaveLength(1);
    expect(ruim[0].kind).toBe('upsert');
    expect(TENANT_COLS.test(ruim[0].text)).toBe(false);

    const bom = writeStatements(
      'insert into billing.ai_chat_sessions (user_id, day) values ($1,$2) ' +
        'on conflict (user_id, day, app, company_id) do update set messages = excluded.messages;',
    );
    expect(TENANT_COLS.test(bom[0].text)).toBe(true);
  });

  it('toda entrada de allowlist tem justificativa de verdade', () => {
    for (const [arquivo, motivo] of Object.entries({ ...WRITE_ALLOWLIST, ...TENANT_INPUT_ALLOWLIST })) {
      expect(motivo.length, `${arquivo} sem justificativa`).toBeGreaterThan(20);
    }
  });

  it('as allowlists não cresceram sem alguém reparar', () => {
    // Estes números são o pedágio: liberar mais um arquivo exige mexer AQUI, e quem
    // revisar o diff vê a linha mudando. É o ponto de uma allowlist com contagem.
    expect(Object.keys(WRITE_ALLOWLIST), 'nova escrita cross-tenant liberada').toHaveLength(3);
    expect(Object.keys(TENANT_INPUT_ALLOWLIST), 'novo DTO aceitando tenant do cliente').toHaveLength(3);
  });
});
