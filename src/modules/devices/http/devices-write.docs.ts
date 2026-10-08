import { ApiBody, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { ApiDocs, ApiSessionErrorResponses, ApiTenantHeaders } from '../../../common/swagger';

/**
 * Documentação OpenAPI das rotas de ESCRITA de dispositivos — fora do controller, para
 * ele mostrar só o que decide o comportamento (rota, guard, entrada, caso de uso).
 *
 * Cada `Doc*` equivale a empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

const NOTA_ESCRITA =
  'O tenant vem da **sessão** (`TenantGuard`), nunca do corpo — hoje o navegador manda a ' +
  'empresa no payload, e aceitar isso deixaria o cliente escolher em nome de quem grava. ' +
  'E o comando leva o tenant no `WHERE`, não só o id: dispositivo de outra empresa ' +
  'devolve **403**, sem escrever nada.';

export const DocSetTotemActive = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Ativa ou desativa um totem',
      description:
        `${NOTA_ESCRITA}\n\n` +
        'A RPC `cloud_set_totem_active` recebe **só o id** — não tem recorte de tenant. Por ' +
        'isso o vínculo totem↔empresa é conferido ANTES de chamá-la.\n\n' +
        '`license_id` **ausente** e `license_id: null` são coisas diferentes: ausente não mexe ' +
        'no vínculo, `null` desvincula. O gatilho do banco recusa totem ativo sem licença, ' +
        'então confundir os dois leva a resultados opostos.',
    }),
    ApiTenantHeaders(),
    ApiParam({ name: 'totemId', schema: { type: 'string', format: 'uuid' } }),
    ApiBody({
      schema: {
        type: 'object',
        required: ['is_active'],
        properties: {
          is_active: { type: 'boolean' },
          license_id: { type: 'string', format: 'uuid', nullable: true },
        },
      },
    }),
    ApiResponse({ status: 200, description: 'Totem atualizado.' }),
    ApiResponse({ status: 403, description: 'Totem não pertence a esta empresa.' }),
    ApiSessionErrorResponses(),
  );

export const DocCreateTotem = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Cria a configuração de um totem',
      description:
        `${NOTA_ESCRITA}\n\n` +
        '**Nasce sempre inativo**, como no navegador — o gatilho do banco recusa totem ativo ' +
        'sem licença, e quem vincula licença é a RPC de ativação. Pedir `is_active: true` ' +
        'aqui devolve `precisa_ativar: true`: a tela chama `PATCH /totems/:id/active` em ' +
        'seguida, com a licença.\n\n' +
        '⚠️ Nos segredos TEF **a presença do campo decide**: ausente mantém, presente vazio ' +
        'apaga. A tela nunca recebe o segredo de volta, então mandar o formulário inteiro com ' +
        'o campo vazio apagaria a credencial em produção — daí a regra ser pela presença.',
    }),
    ApiTenantHeaders(),
    ApiBody({ schema: { type: 'object', required: ['totem_name'], additionalProperties: true } }),
    ApiResponse({ status: 201, description: 'Totem criado; devolve o id e `precisa_ativar`.' }),
    ApiSessionErrorResponses(),
  );

export const DocUpdateTotem = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Edita a configuração de um totem',
      description:
        `${NOTA_ESCRITA}\n\n` +
        'A regra de licença julga o resultado **final**, não só o que veio no corpo: mandar ' +
        '`nfce_environment: 1` sozinho num totem demo é barrado igual, porque o que vale é ' +
        'como o totem fica depois de salvar.\n\n' +
        '`is_active` no corpo **não grava** — ligar/desligar é da rota de ativação, que trata ' +
        'o vínculo de licença junto.\n\n' +
        'A auditoria registra que o segredo TEF mudou, mas grava `***` no de/para: auditoria ' +
        'não é lugar de guardar segredo.',
    }),
    ApiTenantHeaders(),
    ApiParam({ name: 'totemId', schema: { type: 'string', format: 'uuid' } }),
    ApiBody({
      description: 'Envie apenas os campos a alterar. Omitir ≠ enviar vazio.',
      schema: { type: 'object', additionalProperties: true },
    }),
    ApiResponse({ status: 200, description: 'Totem atualizado; `changed` lista o que mudou.' }),
    ApiResponse({ status: 403, description: 'Totem não pertence a esta empresa.' }),
    ApiSessionErrorResponses(),
  );

export const DocRequeueTotemSync = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Reenfileira a sincronização do totem',
      description: `${NOTA_ESCRITA}\n\nMesma amarra da rota de ativação: a RPC recebe só o id.`,
    }),
    ApiTenantHeaders(),
    ApiParam({ name: 'totemId', schema: { type: 'string', format: 'uuid' } }),
    ApiResponse({ status: 200, description: 'Reenfileirado.' }),
    ApiResponse({ status: 403, description: 'Totem não pertence a esta empresa.' }),
    ApiSessionErrorResponses(),
  );

export const DocCreateAgent = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Cria um agente de NFC-e',
      description:
        `${NOTA_ESCRITA}\n\n` +
        'A auditoria é gravada na **mesma transação** do insert: criar o agente e perder o ' +
        'rastro de quem o criou é pior que falhar os dois. O navegador faz as duas escritas ' +
        'soltas, então uma falha no meio deixa alteração sem registro.\n\n' +
        'Os limites numéricos não são decoração: `sefaz_timeout_ms` baixo demais derruba ' +
        'emissão que a SEFAZ demora a responder, e `retry_max_attempts` alto demais ' +
        'transforma indisponibilidade em enxurrada de retentativa.',
    }),
    ApiTenantHeaders(),
    ApiBody({ schema: { type: 'object', required: ['agent_name'], additionalProperties: true } }),
    ApiResponse({ status: 201, description: 'Agente criado; devolve o id.' }),
    ApiSessionErrorResponses(),
  );

export const DocUpdateAgent = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Edita um agente de NFC-e',
      description:
        `${NOTA_ESCRITA}\n\n` +
        '**O nome não é editável** e o schema nem o aceita: é chave única e o serviço da loja ' +
        'se reconhece por ele.\n\n' +
        'A auditoria grava só o que **mudou de fato** — salvar o formulário sem alterar nada ' +
        'não gera registro. Auditoria cheia de linha vazia é auditoria que ninguém lê.',
    }),
    ApiTenantHeaders(),
    ApiParam({ name: 'agentId', schema: { type: 'string', format: 'uuid' } }),
    ApiBody({
      description: 'Envie apenas os campos a alterar.',
      schema: { type: 'object', additionalProperties: true },
    }),
    ApiResponse({ status: 200, description: 'Agente atualizado; `changed` lista o que mudou.' }),
    ApiResponse({ status: 403, description: 'Agente não pertence a esta empresa.' }),
    ApiSessionErrorResponses(),
  );

export const DocSetAgentActive = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Ativa ou desativa um agente de NFC-e',
      description:
        `${NOTA_ESCRITA}\n\n` +
        'Esta é literalmente a correção do `.update({is_active}).eq("id", id)` do navegador: ' +
        'o `company_id` entra no `WHERE` e o `returning` prova que a linha existia e era da ' +
        'empresa. Se voltar vazio, não houve escrita — e a resposta é 403, não 200 silencioso.\n\n' +
        '**Desativar o agente de NFC-e de uma loja para a emissão de nota fiscal dela.** É a ' +
        'escrita de maior consequência deste conjunto.',
    }),
    ApiTenantHeaders(),
    ApiParam({ name: 'agentId', schema: { type: 'string', format: 'uuid' } }),
    ApiBody({
      schema: { type: 'object', required: ['is_active'], properties: { is_active: { type: 'boolean' } } },
    }),
    ApiResponse({ status: 200, description: 'Agente atualizado.' }),
    ApiResponse({ status: 403, description: 'Agente não pertence a esta empresa.' }),
    ApiSessionErrorResponses(),
  );

export const DocSavePixnopdv = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Salva as credenciais do PIXnoPDV',
      description:
        `${NOTA_ESCRITA}\n\n` +
        '⚠️ **A PRESENÇA do campo decide, não o valor.** Campo ausente mantém o que está ' +
        'gravado; campo presente com string vazia **apaga**.\n\n' +
        'Essa regra evita o pior bug possível desta rota: a tela nunca recebe o segredo de ' +
        'volta (só o booleano `_set`), então salvar o formulário inteiro mandaria ' +
        '`basic_token: ""` — e sem a regra isso apagaria a credencial em produção sem ninguém ' +
        'pedir, derrubando o PIX da loja.\n\n' +
        'A resposta **nunca** devolve os segredos: só `basic_token_set` e `secret_key_set`.',
    }),
    ApiTenantHeaders(true),
    ApiBody({
      description: 'Envie APENAS os campos que quer alterar. Omitir ≠ enviar vazio.',
      schema: {
        type: 'object',
        properties: {
          api_base_url: { type: 'string', nullable: true },
          basic_user: { type: 'string', nullable: true },
          basic_token: { type: 'string', nullable: true, description: 'Omitir mantém o atual.' },
          secret_key: { type: 'string', nullable: true, description: 'Omitir mantém o atual.' },
          insecure_tls: { type: 'boolean' },
          enabled: { type: 'boolean' },
        },
      },
    }),
    ApiResponse({ status: 200, description: 'Credenciais salvas, sem os segredos na resposta.' }),
    ApiSessionErrorResponses(),
  );
