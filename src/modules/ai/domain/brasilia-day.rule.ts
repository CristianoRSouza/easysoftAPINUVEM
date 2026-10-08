/**
 * Dia corrente no fuso de Brasília, em `YYYY-MM-DD`.
 *
 * O servidor roda em UTC; usar a data dele viraria o dia às 21h para o usuário, e a
 * conversa em andamento saltaria para o histórico no meio do expediente.
 */
export function diaEmBrasilia(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
