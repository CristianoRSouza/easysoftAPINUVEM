import { z } from 'zod';

const secretField = z
  .string()
  .max(4096)
  .refine((v) => !v.includes('\0'), { message: 'sem null bytes' })
  .nullable()
  .optional();

export const encryptTefSchema = z.object({
  store_id: z.string().uuid(),
  partner_token: secretField,
  ativation_code: secretField,
});
export type EncryptTefInput = z.infer<typeof encryptTefSchema>;
