import { ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import {
  ApiDocs,
  ApiSessionErrorResponses,
  ApiTenantHeaders,
  listOf,
} from '../../../common/swagger';

/**
 * Documentação OpenAPI das rotas de leitura de NFC-e — fora do controller, para ele mostrar
 * só o que decide o comportamento (rota, guard, entrada, caso de uso).
 *
 * Cada `Doc*` equivale a empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

const CHILD_NOTE =
  'A nota é amarrada à loja do `X-Store-Id` antes de qualquer coisa. Nota de outra loja ' +
  'devolve **lista vazia**, não 404 — responder diferente transformaria a rota num ' +
  'verificador de existência de documento fiscal alheio.';

/**
 * Os cinco filtros que listagem, totais e download de XML aceitam — os mesmos, na mesma
 * ordem, porque as três rotas precisam enxergar o mesmo conjunto de notas.
 */
export const filtrosDaListagem = () => [
  ApiQuery({ name: 'status', required: false, schema: { type: 'string', example: 'authorized' } }),
  ApiQuery({ name: 'reconcileStatus', required: false, schema: { type: 'string' } }),
  ApiQuery({ name: 'from', required: false, schema: { type: 'string', example: '2026-07-01' } }),
  ApiQuery({ name: 'to', required: false, schema: { type: 'string', example: '2026-07-31' } }),
  ApiQuery({ name: 'search', required: false, schema: { type: 'string' } }),
];

export const noteIdParam = () =>
  ApiParam({ name: 'noteId', schema: { type: 'string', format: 'uuid' } });

export const DocAttentionCounts = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Contadores dos cards de atenção',
      description:
        'Notas em revisão manual, com reconciliação falha e inutilizáveis — uma consulta, três ' +
        '`count(*) filter`.\n\n' +
        'A contagem aqui é **exata**. O browser usava a estimativa do planner (`count: estimated`) ' +
        'com medo do full-scan de três contagens separadas; com o filtro por loja e uma varredura ' +
        'só, o custo deixa de justificar o número aproximado — card de atenção com número chutado ' +
        'faz o usuário perder a confiança no painel.',
    }),
    ApiTenantHeaders(true),
    ApiResponse({
      status: 200,
      description: 'Contadores.',
      schema: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              manualReview: { type: 'integer' },
              reconcileFailed: { type: 'integer' },
              unusable: { type: 'integer' },
            },
          },
        },
      },
    }),
    ApiSessionErrorResponses(),
  );

export const DocNotes = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Notas da loja, paginadas',
      description:
        'Mais recentes primeiro. `search` casa com chave de acesso, protocolo ou número — o ' +
        'número só entra quando o termo é numérico (senão o cast quebraria a consulta). ' +
        '`from`/`to` recortam por `issued_at`, inclusivos.\n\n' +
        'No browser eram **três** idas ao Supabase (notas, destinatários, pagamentos) cruzadas ' +
        'em JavaScript; aqui é uma consulta com dois laterais. E o `total` é **exato**, não a ' +
        'estimativa do planner: paginação com total aproximado mostra "página 7 de 5".\n\n' +
        '`valor_total` viaja como **string** — valor fiscal não deve passar por float.',
    }),
    ApiTenantHeaders(true),
    ...filtrosDaListagem(),
    ApiQuery({ name: 'page', required: false, schema: { type: 'integer', default: 1 } }),
    ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', default: 50, maximum: 200 } }),
    ApiResponse({
      status: 200,
      description: 'Página de notas e o total que casa com os filtros.',
      schema: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { type: 'object', additionalProperties: true } },
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
        },
      },
    }),
    ApiSessionErrorResponses(),
  );

export const DocTotals = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Totais dos cards, do período inteiro',
      description:
        'Contagem por status e soma do valor autorizado, com os MESMOS filtros da listagem ' +
        '(`status`, `from`, `to`, `search`, `reconcileStatus`) e sem `page`/`limit`.\n\n' +
        '⚠️ Existe porque a tela somava as linhas **carregadas**: com 1.164 notas no filtro e 50 ' +
        'por página, o card "Autorizadas" mostrava 50 e o "Valor autorizado" somava só essas 50. ' +
        'Não era arredondamento — era a página inteira faltando, sem nenhum sinal de que faltava.\n\n' +
        '`porStatus` traz a chave **crua** do banco (minúscula), não normalizada: quem dobra os ' +
        'apelidos (`inutilizada` → `inutilized`) é a tela, que já tem esse mapa. Repetir o mapa ' +
        'aqui daria dois lugares para manter — e no dia em que divergissem, o card mostraria um ' +
        'número e a linha da tabela outro.\n\n' +
        '`valorAutorizado` viaja como **string** e soma **apenas** `authorized`: nota rejeitada ' +
        'tem valor no rascunho, mas não houve venda — misturar as duas infla o faturamento.',
    }),
    ApiTenantHeaders(true),
    ...filtrosDaListagem(),
    ApiResponse({
      status: 200,
      description: 'Totais do período.',
      schema: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              porStatus: { type: 'object', additionalProperties: { type: 'integer' } },
              valorAutorizado: { type: 'string', example: '25130.45' },
            },
          },
        },
      },
    }),
    ApiSessionErrorResponses(),
  );

export const DocDetail = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Detalhe da nota',
      description:
        'A nota e as cinco tabelas filhas (identificação, emitente, destinatário, informações ' +
        'adicionais e as formas de pagamento) achatadas em ~99 campos — **uma** consulta, contra ' +
        'as seis chamadas paralelas que o browser faz e junta em JavaScript.\n\n' +
        'Devolve `data: null` quando a nota não existe **ou** é de outra loja: o filtro por loja ' +
        'está na raiz da junção, então id alheio não casa. Não é 404 — responder diferente ' +
        'transformaria a rota num verificador de existência de documento fiscal alheio.\n\n' +
        'Os totais viajam como **string**. Isso não é formatação: o total de uma nota autorizada ' +
        'precisa bater centavo a centavo com o XML enviado à SEFAZ, e ponto flutuante não garante ' +
        'isso. Nota sem destinatário é o caso NORMAL numa NFC-e — os campos `destinatario_*` ' +
        'vindo nulos não indicam erro.',
    }),
    ApiTenantHeaders(true),
    noteIdParam(),
    ApiResponse({
      status: 200,
      description: 'Nota completa, ou `null`.',
      schema: {
        type: 'object',
        properties: { data: { type: 'object', nullable: true, additionalProperties: true } },
      },
    }),
    ApiSessionErrorResponses(),
  );

export const DocIssuerConfig = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Configuração do emitente (dados fiscais da loja)',
      description:
        'Junta numa consulta o que o browser busca em três: a loja, o certificado ativo e a ' +
        'chave de API. Devolve uma **lista de 0 ou 1** — formato que a tela já consome.\n\n' +
        '🔒 **CSC (`nfce_security_code`)**: o código que assina o QR Code da NFC-e. Quem tem ' +
        'CSC + CNPJ gera cupom fiscal válido no nome da loja. Por decisão de 2026-07-30, o ' +
        '**valor só vai para ADMIN da empresa**; para os demais vem `null` + ' +
        '`nfce_security_code_set: true`. Quem configura emitente é sempre admin, então quem ' +
        'precisa ver continua vendo.\n\n' +
        'Senha do certificado e tokens TEF vêm **sempre `null`** — já era assim no browser e ' +
        'foi preservado. A chave de API sai mascarada (`prefixo••••••••`): o valor completo ' +
        'nunca existiu em claro no banco.',
    }),
    ApiTenantHeaders(true),
    ApiResponse({
      status: 200,
      description: 'Lista de 0 ou 1 configuração.',
      schema: { type: 'object', properties: { data: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
    }),
    ApiSessionErrorResponses(),
  );

export const DocAcbrConfig = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Parâmetros ACBr da loja',
      description:
        'Espelho só de leitura de `nfce_acbr_config` do POS (log, tentativas, timeout da ' +
        'SEFAZ), sincronizado pelo Sync-PG-SB. Quem altera é a loja.',
    }),
    ApiTenantHeaders(true),
    ApiResponse({
      status: 200,
      description: 'Parâmetros ordenados por chave.',
      schema: { type: 'object', properties: { data: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
    }),
    ApiSessionErrorResponses(),
  );

export const DocItems = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Itens da nota, com os impostos',
      description:
        'Itens e os quatro blocos de imposto (ICMS, PIS, COFINS e total de tributos) numa ' +
        'consulta — no browser eram **cinco** idas ao Supabase cruzadas por `Map`.\n\n' +
        'A amarra de loja é **direta em cada JOIN**, não derivada: as views de imposto têm ' +
        '`store_id`, então não dependemos de "o id veio de uma consulta que já filtrou" — ' +
        'dependência que quebra em silêncio quando alguém reordena o código.\n\n' +
        '`icms_cst_csosn` traz o CST **ou** o CSOSN: são excludentes (regime normal × Simples) ' +
        'e a tela mostra o que houver.\n\n' +
        'Valores fiscais saem como **string**. Imposto ausente vem `null`, não `"0"` — nota ' +
        `sem o imposto e nota com imposto zerado são coisas diferentes.\n\n${CHILD_NOTE}`,
    }),
    ApiTenantHeaders(true),
    noteIdParam(),
    ApiResponse({ status: 200, description: 'Itens, por número.', schema: listOf({}) }),
    ApiSessionErrorResponses(),
  );

export const DocPayments = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Pagamentos da nota',
      description:
        `Formas de pagamento com os rótulos fiscais já resolvidos (\`forma_descricao\`, ` +
        `\`bandeira_descricao\`, \`integracao_descricao\`) — a tela não precisa carregar as ` +
        `tabelas do layout da NFC-e. Valores como **string**, por serem fiscais.\n\n${CHILD_NOTE}`,
    }),
    ApiTenantHeaders(true),
    noteIdParam(),
    ApiResponse({ status: 200, description: 'Pagamentos.', schema: listOf({}) }),
    ApiSessionErrorResponses(),
  );

export const DocLogs = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Histórico técnico da nota',
      description: `Mais recentes primeiro. \`details\` sai sempre como string ou \`null\` ` +
        `(a coluna é \`jsonb\`; serializamos aqui para o contrato não variar).\n\n${CHILD_NOTE}`,
    }),
    ApiTenantHeaders(true),
    noteIdParam(),
    ApiResponse({ status: 200, description: 'Logs.', schema: listOf({}) }),
    ApiSessionErrorResponses(),
  );

export const DocEvents = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Eventos fiscais da nota (cancelamento, carta de correção)',
      description: `Mais recentes primeiro, por \`event_at\`.\n\n${CHILD_NOTE}`,
    }),
    ApiTenantHeaders(true),
    noteIdParam(),
    ApiResponse({ status: 200, description: 'Eventos.', schema: listOf({}) }),
    ApiSessionErrorResponses(),
  );
