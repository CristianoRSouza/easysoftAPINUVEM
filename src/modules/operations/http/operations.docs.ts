import { ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import {
  ApiDocs,
  ApiSessionErrorResponses,
  ApiTenantHeaders,
  listOf,
} from '../../../common/swagger';

/**
 * Documentação OpenAPI das rotas de operação — fora do controller, para ele caber numa
 * tela e mostrar só o que decide o comportamento (rota, guard, entrada, caso de uso).
 *
 * Cada `Doc*` equivale a empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

const orderProperties = {
  id: { type: 'string', format: 'uuid' },
  barcode: { type: 'string', example: 'CMD-000123' },
  customer_name: { type: 'string', nullable: true },
  table_name: { type: 'string', example: 'Mesa 4' },
  status: { type: 'string', example: 'open' },
  sync_close_pending: { type: 'boolean' },
  sync_close_attempts: { type: 'integer' },
  sync_close_last_error: { type: 'string', nullable: true },
  sync_close_requested_at: { type: 'string', format: 'date-time', nullable: true },
  sync_closed_to_fb_at: { type: 'string', format: 'date-time', nullable: true },
  totem_name: { type: 'string', nullable: true },
  fb_sale_id: { type: 'integer', nullable: true },
  fb_cash_register_id: { type: 'integer', nullable: true },
  created_at: { type: 'string', format: 'date-time' },
  updated_at: { type: 'string', format: 'date-time' },
  tef_cancel_fb_sale_already_closed: { type: 'boolean' },
  tef_cancel_fb_sale_count: { type: 'integer' },
  tef_cancel_fb_sale_message: { type: 'string', nullable: true },
  tef_cancel_fb_sale_transaction_id: { type: 'string', format: 'uuid', nullable: true },
} as const;

const orderItemProperties = {
  id: { type: 'string', format: 'uuid' },
  order_id: { type: 'string', format: 'uuid' },
  product_id: { type: 'string', format: 'uuid', nullable: true },
  product_name: { type: 'string' },
  product_barcode: { type: 'string' },
  quantity: { type: 'number' },
  unit_price: { type: 'number' },
  subtotal: { type: 'number' },
  origin: { type: 'string', example: 'system' },
  status: { type: 'string', example: 'active' },
  synced_to_fb: { type: 'boolean' },
  fb_id: { type: 'integer', nullable: true },
  unit_name: { type: 'string', nullable: true },
  created_at: { type: 'string', format: 'date-time' },
} as const;

const transactionProperties = {
  id: { type: 'string', format: 'uuid' },
  order_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
  payment_method: { type: 'string', example: 'credit' },
  amount: { type: 'number', example: 42.9 },
  installments: { type: 'integer', example: 1 },
  nsu: { type: 'string', nullable: true },
  authorization_code: { type: 'string', nullable: true },
  tef_transaction_id: { type: 'string', nullable: true },
  status: { type: 'string', example: 'approved' },
  created_at: { type: 'string', format: 'date-time' },
  tef_result: { type: 'object', nullable: true, additionalProperties: true },
  pix_qrcode_id: { type: 'string', nullable: true },
  pix_status: { type: 'string', nullable: true },
  pix_txid: { type: 'string', nullable: true },
  pix_e2e_id: { type: 'string', nullable: true },
  pix_paid_at: { type: 'string', format: 'date-time', nullable: true },
  pix_last_poll_at: { type: 'string', format: 'date-time', nullable: true },
  pix_provider_url: { type: 'string', nullable: true },
} as const;

const DATE_NOTE =
  '`from`/`to` são `YYYY-MM-DD` **inclusivos**, recortados por dia civil no fuso do BANCO — ' +
  'igual à Admin-API da loja. No browser o corte usava o fuso de quem estava olhando a tela; ' +
  'a mudança faz as duas implementações concordarem entre si.';

export const DocOrders = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Comandas da loja',
      description:
        `Mais recentes primeiro, teto de 1000. ${DATE_NOTE}\n\n` +
        'Cada comanda traz `tef_cancel_fb_sale_already_closed` / `_count` / `_message` / ' +
        '`_transaction_id`, derivados das transações canceladas com ' +
        '`tef_result.tefCancelFbSaleAlreadyClosed` — mesma regra da Admin-API da loja.',
    }),
    ApiTenantHeaders(true),
    ApiResponse({ status: 200, description: 'Comandas.', schema: listOf(orderProperties) }),
    ApiSessionErrorResponses(),
  );

export const DocOrderItems = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Itens de comanda',
      description:
        `Com \`orderId\`, devolve os itens daquela comanda (e ignora as datas). Com intervalo, ` +
        `o recorte vem de um JOIN com as comandas. ${DATE_NOTE}\n\n` +
        'Para intervalo, o browser fazia até 21 chamadas ao Supabase — uma para buscar 3000 ids ' +
        'de comanda e mais uma a cada 150 ids, com merge e reordenação em JavaScript. Aqui é ' +
        'uma consulta.',
    }),
    ApiTenantHeaders(true),
    ApiResponse({ status: 200, description: 'Itens.', schema: listOf(orderItemProperties) }),
    ApiSessionErrorResponses(),
  );

export const DocTransactions = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Transações da loja',
      description:
        `Mais recentes primeiro, teto de 1000. ${DATE_NOTE}\n\n` +
        '`orderId` filtra as transações que contêm aquela comanda em `order_ids` (a coluna é um ' +
        'array; usamos `@>`, que aproveita índice GIN). Campos de TEF/PIX em branco voltam como ' +
        '`null`: string vazia é ausência de dado, e a tela mostraria um chip vazio.',
    }),
    ApiTenantHeaders(true),
    ApiResponse({
      status: 200,
      description: 'Transações.',
      schema: listOf(transactionProperties),
    }),
    ApiSessionErrorResponses(),
  );

export const DocDashboardStats = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Números do topo do dashboard',
      description:
        'Produtos ativos, comandas abertas e transações de hoje — as três contagens numa consulta só.\n\n' +
        '`recentErrors`, `lastSuccessSync` e `serviceHeartbeats` vêm SEMPRE zerados/nulos aqui, e ' +
        'isso é a resposta correta, não pendência: `sync_log` e `sync_heartbeat` não existem no ' +
        'Supabase — são tabelas do PostgreSQL da loja. Os campos ficam no contrato para a tela ' +
        'não precisar de dois formatos.',
    }),
    ApiTenantHeaders(true),
    ApiResponse({
      status: 200,
      description: 'Contagens do dashboard.',
      schema: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              activeProducts: { type: 'integer' },
              openOrders: { type: 'integer' },
              todayTransactions: { type: 'integer' },
              recentErrors: { type: 'integer', example: 0 },
              lastSuccessSync: { type: 'object', nullable: true, additionalProperties: true },
              serviceHeartbeats: {
                type: 'object',
                properties: {
                  sync: { type: 'string', nullable: true },
                  nfce: { type: 'string', nullable: true },
                  tef: { type: 'string', nullable: true },
                  syncPgSb: { type: 'string', nullable: true },
                  pixPixnopdv: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
      },
    }),
    ApiSessionErrorResponses(),
  );

export const DocTransactionsByDay = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Transações por dia (últimos 7 dias)',
      description:
        'Sempre **7 pontos**, inclusive os dias sem venda (`generate_series`) — sem isso o gráfico ' +
        'pula o dia parado e dá a impressão de que ele não existiu. `day` é o rótulo `DD/MM` do eixo.\n\n' +
        'No browser esta soma baixava até 20.000 linhas para agregar em JavaScript.',
    }),
    ApiTenantHeaders(true),
    ApiResponse({
      status: 200,
      description: 'Sete pontos, do mais antigo ao mais recente.',
      schema: listOf({
        day: { type: 'string', example: '30/07' },
        total: { type: 'integer' },
        amount: { type: 'number' },
      }),
    }),
    ApiSessionErrorResponses(),
  );

export const DocRevenueApproved = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Receita aprovada — o painel de faturamento',
      description:
        'Oito recortes das transações **aprovadas** em `credit`/`debit`/`pix`: por método, por dia, ' +
        'por hora, por totem, top 10 produtos, ano-a-ano, KPIs e a lista recente paginada. ' +
        'Sem `from`/`to`, o período é os últimos 30 dias até hoje. `from` maior que `to` é ' +
        'invertido, não recusado — intervalo trocado na tela deve mostrar o período, não um erro.\n\n' +
        '**Dois rateios que não são soma simples:** em `byTotem`, o valor da transação é dividido ' +
        'igualmente entre os totens distintos dela (uma transação pode pagar comandas de totens ' +
        'diferentes). Em `byProductTop10`, é rateado entre os itens na proporção do subtotal — por ' +
        'isso a soma dos produtos bate com o faturamento mesmo com desconto na transação. Item ' +
        'cancelado fica fora do rateio e do denominador.\n\n' +
        '`byHour` tem sempre 24 posições; `byDay` traz só os dias com venda; `byMonthYoY` cobre ' +
        'todos os meses do período, inclusive os sem venda.\n\n' +
        'No browser este relatório era montado em JavaScript a partir de até 5.000 transações, ' +
        '5.000 comandas e 20.000 itens baixados — tetos que **truncavam em silêncio**. Aqui a ' +
        'agregação roda no banco, sobre o período inteiro.',
    }),
    ApiTenantHeaders(true),
    ApiQuery({ name: 'from', required: false, schema: { type: 'string', example: '2026-07-01' } }),
    ApiQuery({ name: 'to', required: false, schema: { type: 'string', example: '2026-07-31' } }),
    ApiQuery({ name: 'recentOffset', required: false, schema: { type: 'integer', default: 0 } }),
    ApiQuery({
      name: 'recentLimit',
      required: false,
      schema: { type: 'integer', default: 50, maximum: 200 },
    }),
    ApiResponse({
      status: 200,
      description: 'Relatório completo do período.',
      schema: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              period: {
                type: 'object',
                properties: { from: { type: 'string' }, to: { type: 'string' } },
              },
              byMethod: { type: 'object', additionalProperties: true },
              total: {
                type: 'object',
                properties: { amount: { type: 'number' }, count: { type: 'integer' } },
              },
              kpis: { type: 'object', additionalProperties: true },
              byHour: { type: 'array', items: { type: 'object', additionalProperties: true } },
              recentApproved: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
              recentApprovedMeta: { type: 'object', additionalProperties: true },
              byTotem: { type: 'array', items: { type: 'object', additionalProperties: true } },
              byProductTop10: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
              byMonthYoY: { type: 'array', items: { type: 'object', additionalProperties: true } },
              byDay: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
      },
    }),
    ApiSessionErrorResponses(),
  );

export const DocSyncByHour = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Sincronizações por hora — sempre vazio na nuvem',
      description:
        'Devolve `[]`, e isso é a resposta correta: `command.sync_log` foi REMOVIDA do Supabase. ' +
        'O painel só faz sentido com o PostgreSQL da loja, onde a Admin-API local o preenche. ' +
        'A rota existe para a tela ter um formato só nos dois modos, em vez de um `if`.',
    }),
    ApiTenantHeaders(true),
    ApiResponse({
      status: 200,
      description: 'Sempre uma lista vazia nesta implementação.',
      schema: listOf({
        hour: { type: 'string', example: '30/07 14:00' },
        ok: { type: 'integer' },
        error: { type: 'integer' },
      }),
    }),
    ApiSessionErrorResponses(),
  );
