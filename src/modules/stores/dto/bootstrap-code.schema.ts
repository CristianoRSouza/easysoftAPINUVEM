import { z } from 'zod';

/** Corpo de POST /stores/:storeId/bootstrap-code. email/store validados no service (regex exata). */
export const bootstrapCodeSchema = z.object({
  email: z.string(),
  ttl_hours: z.number().optional(),
});
export type BootstrapCodeInput = z.infer<typeof bootstrapCodeSchema>;
