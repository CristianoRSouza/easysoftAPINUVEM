import { z } from 'zod';

/** Corpo de POST /auth/recovery-email (público). email validado no service (regex + 200 constante). */
export const recoverySchema = z.object({
  email: z.string().optional(),
  app: z.string().optional(),
  redirect_to: z.string().optional(),
  app_name: z.string().optional(),
  subject: z.string().optional(),
  source: z.string().optional(),
  brand_color: z.string().optional(),
});
export type RecoveryInput = z.infer<typeof recoverySchema>;
