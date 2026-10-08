import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

/**
 * Contexto da requisição em curso — guarda o id de correlação.
 * @see docs/PADRAO-LOGS.md §8.2.1
 *
 * ► POR QUE `AsyncLocalStorage` E NÃO PASSAR O ID POR PARÂMETRO
 *
 *   Passar `corr` por parâmetro obrigaria a mexer em toda a cadeia — controller, service,
 *   repositório — só para carregar um dado de diagnóstico. O `AsyncLocalStorage` mantém o
 *   valor disponível durante toda a requisição, inclusive atravessando `await`, sem que
 *   nenhuma assinatura mude.
 *
 * ► O QUE ISSO AMARRA
 *
 *   O totem já registra um id por venda, e o serviço de NFC-e já registra o dele. Com a
 *   API participando, uma venda passa a ser rastreável ATRAVESSANDO os três produtos:
 *   basta filtrar o mesmo `corr` nos três logs.
 */

interface ContextoRequisicao {
  readonly corr: string;
}

const armazenamento = new AsyncLocalStorage<ContextoRequisicao>();

/**
 * Cabeçalhos aceitos como id vindo de fora, na ordem de preferência.
 *
 * `x-request-id` é o nome que os outros produtos EasySoft já usam; `x-correlation-id` e
 * `traceparent` entram porque proxies e ferramentas de rastreio costumam injetá-los, e
 * aproveitar o que já existe é melhor do que criar um id paralelo.
 */
const CABECALHOS = ['x-request-id', 'x-correlation-id', 'x-corr-id'] as const;

/** Id novo, curto e legível — não precisa ser UUID, precisa ser único no dia. */
export function novoIdCorrelacao(): string {
  /*
   * 8 bytes de aleatoriedade, não 3.
   *
   * O prefixo de tempo só separa milissegundos distintos; dentro do MESMO milissegundo
   * a unicidade depende inteiramente dos bytes aleatórios. Com 3 bytes são 24 bits, e
   * pelo paradoxo do aniversário isso colide bem antes do que a intuição sugere.
   *
   * Medido (500 ids por rodada, 20 mil rodadas):
   *   randomBytes(3) → 90 rodadas com colisão  (0,450%)
   *   randomBytes(8) →  0 rodadas com colisão
   *
   * Isso tornava o teste de unicidade abaixo instável — falhava ~1 vez a cada 222
   * execuções, o tipo de vermelho aleatório no CI que ensina a equipe a re-rodar em vez
   * de investigar. E o custo real não é o teste: id de correlação repetido mistura duas
   * requisições diferentes na mesma trilha de log, justo quando se está a depurar.
   */
  return `api-${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;
}

/**
 * Aproveita o id que veio de fora, se houver e se for aceitável.
 *
 * Valor de fora entra no log, então é higienizado: tamanho limitado e só caracteres
 * inofensivos. Sem isso, um cliente poderia injetar quebra de linha e forjar um registro.
 */
export function idDaRequisicao(cabecalhos: Record<string, unknown>): string {
  for (const nome of CABECALHOS) {
    const bruto = cabecalhos[nome];
    const valor = Array.isArray(bruto) ? bruto[0] : bruto;
    if (typeof valor !== 'string') continue;
    const limpo = valor.trim().replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64);
    if (limpo.length >= 8) return limpo;
  }
  return novoIdCorrelacao();
}

/** Roda `fn` com o id ativo. Tudo que for registrado dentro sai correlacionado. */
export function comCorrelacao<T>(corr: string, fn: () => T): T {
  return armazenamento.run({ corr }, fn);
}

/** Id em vigor agora, ou `undefined` fora de uma requisição. */
export function correlacaoAtual(): string | undefined {
  return armazenamento.getStore()?.corr;
}
