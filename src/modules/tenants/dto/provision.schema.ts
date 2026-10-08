import { z } from 'zod';

/**
 * Contrato do POST /v1/tenants/provision — mesma forma que a edge function antiga
 * consumia, para o cliente (ProvisionTenantFromNfceIssuerJob) não quebrar.
 * (Futuro: extrair para packages/shared e compartilhar com o front — EasyML §9.)
 */
export const userSchema = z.object({
  email: z.string().email(),
  full_name: z.string().optional(),
  password: z.string().optional(),
  role: z.enum(['system_admin', 'company_admin', 'user']).optional(),
});

export const storeSchema = z.object({
  store_id: z.string().uuid().optional(),
  cnpj: z.string().optional(),
  legacy_store_code: z.number().int().optional(),
  legal_name: z.string().optional(),
  trade_name: z.string().optional(),
  state_registration: z.string().optional(),
  municipal_registration: z.string().optional(),
  cnae: z.string().optional(),
  address: z.string().optional(),
  address_number: z.string().optional(),
  address_complement: z.string().optional(),
  neighborhood: z.string().optional(),
  zip_code: z.string().optional(),
  phone1: z.string().optional(),
  phone2: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  store_type: z.enum(['headquarters', 'branch']).optional(),
  users: z.array(userSchema).optional(),
});

export const provisionSchema = z.object({
  company: z
    .object({
      company_id: z.string().uuid().optional(),
      cnpj: z.string().optional(),
      name: z.string().optional(),
      document: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
    })
    .refine((c) => Boolean(c.company_id || c.cnpj), {
      message: 'company.company_id ou company.cnpj é obrigatório',
    }),
  stores: z.array(storeSchema).min(1, 'stores não pode ser vazio'),
});

export type ProvisionInput = z.infer<typeof provisionSchema>;
