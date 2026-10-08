/** O que o navegador recebe quando o EasyAI recusa a conversa ANTES do primeiro byte. */
export interface FalhaDaPortaDeIa {
  status: number;
  error: 'ai_insufficient_credits' | 'ai_rate_limited' | 'ai_upstream_error';
  message: string;
}

const MENSAGEM_PADRAO = 'O assistente não conseguiu responder agora.';

/**
 * Traduz a recusa do EasyAI (status + corpo cru) no erro que esta API devolve.
 *
 * Função pura: não registra log nem lança — quem chama decide o que fazer com o resultado.
 */
export function traduzirFalhaDaPortaDeIa(statusUpstream: number, detalhe: string): FalhaDaPortaDeIa {
  let mensagem = MENSAGEM_PADRAO;
  try {
    // `message` PRIMEIRO: no EasyAI é lá que mora o texto legível; `error` é o CÓDIGO.
    // Ler o campo errado faria o cliente ver "ai_insufficient_credits" na tela, em vez de
    // "seus créditos acabaram".
    const corpo = JSON.parse(detalhe) as { error?: string; message?: string };
    if (corpo.message) mensagem = corpo.message;
    else if (corpo.error) mensagem = corpo.error;
  } catch {
    /* corpo não-JSON: fica a mensagem padrão */
  }

  // Repassa o SIGNIFICADO, não só o código — mas só o que é sobre o usuário:
  //
  //   402/429 são dele ("sem saldo", "muitas mensagens seguidas"): a tela do EasyFood já
  //   trata cada um de um jeito, e achatá-los em 503 faria o cliente ler "indisponível"
  //   quando o problema é saldo, com ação totalmente diferente.
  //
  //   401/403 NÃO são dele. Falam da confiança entre esta API e o EasyAI (segredo
  //   errado, vínculo de empresa que lá não confere). Repassar 401 ao navegador faria o
  //   front derrubar uma sessão que está perfeitamente válida aqui — o usuário seria
  //   deslogado por um problema de configuração entre servidores.
  const repassavel = statusUpstream === 402 || statusUpstream === 429;
  const status = repassavel ? statusUpstream : 503;
  const error = repassavel
    ? statusUpstream === 402
      ? 'ai_insufficient_credits'
      : 'ai_rate_limited'
    : 'ai_upstream_error';

  return { status, error, message: mensagem };
}
