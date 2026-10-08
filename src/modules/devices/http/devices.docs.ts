import { ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ApiDocs, ApiSessionErrorResponses, ApiTenantHeaders } from '../../../common/swagger';

/**
 * Documentação OpenAPI das rotas de LEITURA de dispositivos — fora do controller, para
 * ele mostrar só o que decide o comportamento (rota, guard, entrada, caso de uso).
 *
 * Cada `Doc*` equivale a empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

const listSchema = {
  type: 'object' as const,
  properties: { data: { type: 'array', items: { type: 'object', additionalProperties: true } } },
};

const AUDIT_NOTE =
  '`changed_fields`, `previous_values` e `new_values` voltam como lista/objeto **vazios** ' +
  'quando nulos: a tela itera sobre eles, e `null` viraria "não foi possível carregar" em ' +
  'vez de "nada mudou aqui".';

export const DocTotems = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Configuração dos totens da empresa',
      description:
        '🔒 **As chaves de API não são devolvidas.** No lugar de `nfce_service_api_key`, ' +
        '`tef_http_api_key`, `pix_http_api_key` e dos tokens Aditum, vêm ' +
        '`<campo>_set: boolean` dizendo apenas se há valor configurado. O campo na tela é ' +
        'somente-escrita: mostra se existe chave e aceita uma nova para substituir.\n\n' +
        'Motivo: no modo nuvem o navegador **não usava** essas chaves — o único uso eram os ' +
        'botões "Testar conexão", que o próprio navegador bloqueia (página HTTPS chamando ' +
        'serviço HTTP na LAN). Viajavam para nada. Os `_kid` continuam vindo: identificam ' +
        'qual chave cifrou o token e são necessários para rotação, sem serem segredo.\n\n' +
        'A licença vinculada vem junto (leitura de `billing.device_licenses`). Quando um ' +
        'totem tem mais de uma, a **real ganha da demo** — sem essa regra um totem pago ' +
        'apareceria como demo só pela ordem das linhas.\n\n' +
        'Inclui os totens **globais da empresa** (`store_id` nulo), como em `/service-agents`.',
    }),
    ApiTenantHeaders(),
    ApiResponse({ status: 200, description: 'Totens, por nome.', schema: listSchema }),
    ApiSessionErrorResponses(),
  );

export const DocTotemLicenses = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Licenças de totem da empresa',
      description:
        'Base do mapa de rótulos da tela de totens. Leitura de `billing.device_licenses` — a ' +
        'API é **cliente** do billing e nunca escreve nele.',
    }),
    ApiTenantHeaders(),
    ApiResponse({ status: 200, description: 'Licenças da empresa.', schema: listSchema }),
    ApiSessionErrorResponses(),
  );

export const DocAvailableLicenses = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Licenças que a tela pode oferecer para um totem',
      description:
        'As livres (`status = active` e `totem_config_id` nulo) **mais a que já está vinculada ' +
        'ao totem informado em `totemId`**.\n\n' +
        'Passe `totemId` sempre que estiver EDITANDO um totem. Sem ele, um totem que já ' +
        'consome a única licença da empresa recebe lista vazia — e a tela não mostra nem a ' +
        'licença atual, nem opção nenhuma para trocar.',
    }),
    ApiTenantHeaders(),
    ApiQuery({
      name: 'totemId',
      required: false,
      description: 'Totem em edição: a licença vinculada a ele entra na lista.',
      schema: { type: 'string', format: 'uuid' },
    }),
    ApiResponse({ status: 200, description: 'Licenças oferecíveis.', schema: listSchema }),
    ApiSessionErrorResponses(),
  );

export const DocPixnopdvCredentials = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Credenciais do PIXnoPDV (produção)',
      description:
        '🔒 `basic_token` e `secret_key` **não são devolvidos** — vêm `basic_token_set` e ' +
        '`secret_key_set` (booleanos). E isso não custou decisão nenhuma: o mapeamento do ' +
        'Manager-Web já convertia esses campos em booleanos e a tela nunca usou os valores. ' +
        'Eles atravessavam a rede para nada, como as chaves do totem.\n\n' +
        'Devolve `data: null` quando a loja não tem credencial cadastrada — situação normal.',
    }),
    ApiTenantHeaders(true),
    ApiResponse({
      status: 200,
      description: 'Credenciais, sem os segredos.',
      schema: { type: 'object', properties: { data: { type: 'object', nullable: true, additionalProperties: true } } },
    }),
    ApiSessionErrorResponses(),
  );

export const DocProductImages = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Imagens de produto por id',
      description:
        'Mapa `{ id: url }` para a tela de Comandas mostrar a foto do item. `ids` é uma lista ' +
        'separada por vírgula, no máximo 200 por chamada.\n\n' +
        'A loja entra no filtro junto dos ids: sem isso, uma lista de ids de outra loja ' +
        'devolveria as imagens dela. Id que não é da loja simplesmente não volta — a tela ' +
        'mostra o item sem foto, que é o comportamento de hoje.',
    }),
    ApiTenantHeaders(true),
    ApiQuery({ name: 'ids', required: true, schema: { type: 'string', example: 'uuid1,uuid2' } }),
    ApiResponse({
      status: 200,
      description: 'Mapa de id para URL.',
      schema: { type: 'object', properties: { data: { type: 'object', additionalProperties: { type: 'string' } } } },
    }),
    ApiSessionErrorResponses(),
  );

export const DocAgents = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Agentes de NFC-e da empresa',
      description:
        'Inclui os agentes **globais da empresa** (`store_id` nulo) junto dos da loja escolhida — ' +
        'um serviço atendendo todas as lojas é configuração válida, e filtrar só pela loja o ' +
        'sumiria da tela. Sem `X-Store-Id`, devolve todos os agentes da empresa.',
    }),
    ApiTenantHeaders(),
    ApiResponse({ status: 200, description: 'Agentes, por nome.', schema: listSchema }),
    ApiSessionErrorResponses(),
  );

export const DocAgentAudit = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Histórico de alterações de um agente',
      description:
        `Mais recentes primeiro, teto de 500. O agente é amarrado à empresa antes de qualquer ` +
        `coisa — agente de outra empresa devolve **lista vazia**, não 404.\n\n${AUDIT_NOTE}`,
    }),
    ApiTenantHeaders(),
    ApiParam({ name: 'agentId', schema: { type: 'string', format: 'uuid' } }),
    ApiResponse({ status: 200, description: 'Histórico do agente.', schema: listSchema }),
    ApiSessionErrorResponses(),
  );

export const DocTotemAudit = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Histórico de alterações de um totem',
      description: `Mais recentes primeiro, teto de 500. Amarrado à empresa.\n\n${AUDIT_NOTE}`,
    }),
    ApiTenantHeaders(),
    ApiParam({ name: 'totemId', schema: { type: 'string', format: 'uuid' } }),
    ApiResponse({ status: 200, description: 'Histórico do totem.', schema: listSchema }),
    ApiSessionErrorResponses(),
  );

export const DocUnifiedAudit = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Auditoria unificada — totens e agentes na mesma linha do tempo',
      description:
        'No browser eram **quatro** consultas: as duas de auditoria mais duas só para traduzir ' +
        'id em nome, cruzadas por `Map` em JavaScript. Aqui é um `union all` com o nome vindo ' +
        'de LEFT JOIN.\n\n' +
        '`entity_name` cai no prefixo do id quando o dispositivo foi apagado depois da ' +
        'alteração — apagar o totem não pode apagar o rastro de quem mexeu nele. ' +
        `\`source\` diz de onde veio (\`totem\` ou \`agent\`).\n\n${AUDIT_NOTE}`,
    }),
    ApiTenantHeaders(),
    ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', default: 100, maximum: 500 } }),
    ApiResponse({ status: 200, description: 'Linha do tempo unificada.', schema: listSchema }),
    ApiSessionErrorResponses(),
  );
