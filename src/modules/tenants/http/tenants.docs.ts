import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiDocs, ApiServiceKeyAuth, ApiServiceKeyErrorResponses } from '../../../common/swagger';

/**
 * Documentação OpenAPI do provisionamento — fora do controller. `DocProvision` equivale a
 * empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

const userSchema: SchemaObject = {
  type: 'object',
  required: ['email'],
  properties: {
    email: { type: 'string', format: 'email', example: 'gerente@exemplo.com.br' },
    full_name: { type: 'string', example: 'Nome do Gerente' },
    password: {
      type: 'string',
      description: 'Opcional. Omitido → a API gera uma senha temporária e a devolve **uma única vez**.',
    },
    role: { type: 'string', enum: ['system_admin', 'company_admin', 'user'], default: 'user' },
  },
};

const storeSchema: SchemaObject = {
  type: 'object',
  description:
    'Identificação por `store_id` **ou** `cnpj` (nessa ordem, sempre dentro da empresa resolvida). Nenhum dos ' +
    'dois → sempre cria uma loja nova.',
  properties: {
    store_id: { type: 'string', format: 'uuid', description: 'Se existir na empresa, atualiza; senão é usado como id do insert.' },
    cnpj: { type: 'string', description: 'Reformatado para `00.000.000/0000-00` quando tem 14 dígitos.', example: '00.000.000/0001-00' },
    legacy_store_code: {
      type: 'integer',
      description: 'Código legado da loja. Omitido no insert → `max(legacy_store_code)+1` **dentro da empresa**.',
    },
    legal_name: { type: 'string', example: 'Razão Social Exemplo LTDA' },
    trade_name: { type: 'string', example: 'Loja Exemplo' },
    state_registration: { type: 'string' },
    municipal_registration: { type: 'string' },
    cnae: { type: 'string' },
    address: { type: 'string' },
    address_number: { type: 'string' },
    address_complement: { type: 'string' },
    neighborhood: { type: 'string' },
    zip_code: { type: 'string' },
    phone1: { type: 'string' },
    phone2: { type: 'string' },
    email: { type: 'string' },
    website: { type: 'string' },
    store_type: { type: 'string', enum: ['headquarters', 'branch'], default: 'branch' },
    users: {
      type: 'array',
      description: 'Usuários a resolver/criar no Supabase Auth e vincular à empresa (perfil + role + acesso aprovado).',
      items: userSchema,
    },
  },
};

export const DocProvision = () =>
  ApiDocs(
    ApiServiceKeyAuth(),
    ApiOperation({
      summary: 'Provisiona empresa + lojas + usuários + API key (idempotente, atômico)',
      description:
        'Migra a edge function `provision-tenant`. **Máquina-a-máquina**: exige `X-Service-Key` — é chamada pelo ' +
        'Sync-PG-SB (`ProvisionTenantFromNfceIssuerJob`), nunca pelo browser. O contrato de entrada foi mantido ' +
        'igual ao da edge function para não quebrar o cliente.\n\n' +
        '**Idempotência por identidade, não por repetição:** a empresa é resolvida por `company_id` → `cnpj` → ' +
        'insert; cada loja por `store_id` → `cnpj` (sempre restrito à empresa) → insert. O campo `id_resolution` ' +
        'da resposta diz qual caminho foi usado (`client_provided_match` | `matched_by_cnpj` | `newly_created`). ' +
        'Reenviar o mesmo payload **atualiza** em vez de duplicar.\n\n' +
        '**Atomicidade:** todos os upserts (empresa → lojas → perfis/roles/acessos → API key) rodam em UMA ' +
        'transação. Os triggers do banco (outbox p/ POS, estoque, seed, auditoria) continuam disparando sozinhos. ' +
        'Os usuários, porém, são resolvidos no **Supabase Auth ANTES** da transação (via GoTrue admin, nunca lendo ' +
        '`auth.users` no pg) — um rollback da transação **não** apaga o usuário criado no Auth; a reexecução o ' +
        'reaproveita.\n\n' +
        '**Segredos que aparecem UMA vez:** `api_key` (só quando `api_key_status = "created"`; se já existia chave ' +
        'ativa vem `null` e status `existente` — a chave antiga **não** é revelada) e `temporary_password` (só para ' +
        'usuário recém-criado). O banco guarda apenas `sha256` da chave e o prefixo.',
    }),
    ApiBody({
      required: true,
      schema: {
        type: 'object',
        required: ['company', 'stores'],
        properties: {
          company: {
            type: 'object',
            description: '`company_id` **ou** `cnpj` é obrigatório (um dos dois identifica a empresa).',
            properties: {
              company_id: { type: 'string', format: 'uuid' },
              cnpj: { type: 'string', example: '00.000.000/0001-00' },
              name: { type: 'string', description: "Ausente no insert → 'Empresa'.", example: 'Empresa Exemplo LTDA' },
              document: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              address: { type: 'string' },
              city: { type: 'string' },
              state: { type: 'string' },
            },
          },
          stores: { type: 'array', minItems: 1, description: 'Pelo menos uma loja.', items: storeSchema },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description:
        'Tenant provisionado. **Guarde `api_key` e `temporary_password` agora** — não há como recuperá-los depois.',
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          company: {
            type: 'object',
            properties: {
              company_id: { type: 'string', format: 'uuid' },
              cnpj: { type: 'string', nullable: true },
              is_new: { type: 'boolean' },
              id_resolution: { type: 'string', enum: ['client_provided_match', 'matched_by_cnpj', 'newly_created'] },
            },
          },
          stores: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                store_id: { type: 'string', format: 'uuid' },
                legacy_store_code: { type: 'integer' },
                cnpj: { type: 'string', nullable: true },
                is_new: { type: 'boolean' },
                id_resolution: { type: 'string', enum: ['client_provided_match', 'matched_by_cnpj', 'newly_created'] },
                api_key_status: { type: 'string', enum: ['created', 'existente'] },
                api_key_id: { type: 'string', format: 'uuid' },
                api_key: {
                  type: 'string',
                  nullable: true,
                  description: 'Chave em claro (`sk_live_…`) — só quando `api_key_status = "created"`. Aparece UMA vez.',
                },
                users: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      user_id: { type: 'string', format: 'uuid' },
                      email: { type: 'string', format: 'email' },
                      is_new: { type: 'boolean' },
                      temporary_password: { type: 'string', description: 'Só para usuário recém-criado. Aparece UMA vez.' },
                    },
                  },
                },
              },
            },
          },
          message: { type: 'string', example: 'Tenant provisionado. As API Keys aparecem só uma vez — guarde com segurança.' },
        },
      },
    }),
    ApiServiceKeyErrorResponses(),
  );
