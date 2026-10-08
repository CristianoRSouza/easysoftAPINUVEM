import { z } from 'zod';

// Aceita um objeto JSON qualquer, mas limita profundidade/tamanho na borda:
// rejeita não-objeto e caps o payload serializado (evita usar a API como relay de lixo).
export const errorReportSchema = z
  .record(z.unknown())
  .refine((v) => JSON.stringify(v).length <= 64 * 1024, { message: 'payload muito grande (máx 64KB)' });
