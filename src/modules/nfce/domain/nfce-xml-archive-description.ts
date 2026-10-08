/*
 * Como o pacote de XML se apresenta: o nome do .zip e as linhas de "Filtros aplicados" do
 * `_RESUMO.txt`. A montagem do ZIP em si está em `nfce-xml-archive.ts`.
 */

/** Filtros da tela que viajam junto com o download, só para descrever o pacote. */
export interface FiltrosDoDownload {
  status?: string;
  reconcileStatus?: string;
  from?: string;
  to?: string;
  search?: string;
}

/** Rótulos iguais aos do seletor de status da tela — o resumo tem que falar a língua do usuário. */
const ROTULO_STATUS: Record<string, string> = {
  authorized: 'Autorizada',
  rejected: 'Rejeitada',
  denied: 'Denegada',
  cancelled: 'Cancelada',
  unusable: 'Contingencia pendente',
  inutilized: 'Inutilizada',
  sending: 'Enviando',
  manual_review: 'Pendente de correcao',
  draft: 'Rascunho',
};

/**
 * Nome do .zip. Leva o período no nome porque o contador guarda um arquivo por mês, e
 * três downloads chamados `nfce.zip` na pasta de Downloads são indistinguíveis.
 */
export function nomeDoArquivoZip(f: FiltrosDoDownload, agora: Date): string {
  const hoje = agora.toISOString().slice(0, 10);
  if (f.from && f.to) return `nfce-xml-${f.from}-a-${f.to}.zip`;
  if (f.from) return `nfce-xml-desde-${f.from}.zip`;
  if (f.to) return `nfce-xml-ate-${f.to}.zip`;
  return `nfce-xml-completo-${hoje}.zip`;
}

/** As linhas de "Filtros aplicados" do `_RESUMO.txt`. */
export function descreverFiltros(f: FiltrosDoDownload): string[] {
  const linhas: string[] = [];
  if (f.from && f.to) linhas.push(`Periodo: ${ptBr(f.from)} ate ${ptBr(f.to)}`);
  else if (f.from) linhas.push(`Periodo: a partir de ${ptBr(f.from)}`);
  else if (f.to) linhas.push(`Periodo: ate ${ptBr(f.to)}`);
  else linhas.push('Periodo: todo o historico disponivel');

  linhas.push(
    `Status: ${f.status && f.status !== 'all' ? (ROTULO_STATUS[f.status] ?? f.status) : 'Todos'}`,
  );
  if (f.reconcileStatus) linhas.push(`Reconciliacao: ${f.reconcileStatus}`);
  if (f.search) linhas.push(`Busca: ${f.search}`);
  return linhas;
}

/** `2026-07-31` -> `31/07/2026`. Sem `new Date()`: o fuso viraria o dia. */
function ptBr(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
}
