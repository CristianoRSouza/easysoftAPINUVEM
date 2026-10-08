import { z } from 'zod';

/** Corpo opcional de POST /auth/derived-session. */
export const derivedSessionSchema = z.object({
  redirect_to: z.string().url().optional(),
});
export type DerivedSessionInput = z.infer<typeof derivedSessionSchema>;
