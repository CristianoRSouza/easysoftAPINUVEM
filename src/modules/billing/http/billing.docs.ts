import { ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ApiDocs, ApiSessionErrorResponses, ApiTenantHeaders } from '../../../common/swagger';

/**
 * Documentação OpenAPI das rotas de billing — fora do controller, para ele mostrar só o
 * que decide o comportamento (rota, guard, entrada, caso de uso).
 *
 * Cada `Doc*` equivale a empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

const limitQuery = () =>
  ApiQuery({ name: 'limit', required: false, example: 200, description: 'Máximo de linhas (1–1000, default 200).' });

export const DocCredits = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Transações de crédito de IA da loja',
      description:
        'Últimas transações de `billing.credit_transactions` da loja, mais recentes primeiro. ' +
        'O **saldo** é a soma de `amount` (compras positivas, consumos negativos) — a resposta ' +
        'devolve as linhas, não o total, porque a tela também mostra o extrato.\n\n' +
        'O recorte é empresa **+ loja**: crédito de IA é por loja, então filtrar só por empresa ' +
        'somaria o saldo das outras lojas.',
    }),
    ApiTenantHeaders(true),
    limitQuery(),
    ApiResponse({ status: 200, description: 'Lista de transações.' }),
    ApiSessionErrorResponses(),
  );

export const DocUsage = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Log de uso de IA da loja',
      description:
        'Últimas linhas de `billing.usage_log_enriched` da loja, mais recentes primeiro. É daqui ' +
        'que a tela deriva a cota do dia: conta as interações de hoje (fuso de Brasília) que **não** ' +
        'são de suporte.\n\n' +
        'A view acrescenta `platform_display_name` (nome legível do sistema de origem) ao que a ' +
        'tabela crua tem.',
    }),
    ApiTenantHeaders(true),
    limitQuery(),
    ApiResponse({ status: 200, description: 'Lista de usos.' }),
    ApiSessionErrorResponses(),
  );

export const DocLicense = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Estado da licença da empresa',
      description:
        'Licença mais recente da empresa, **já classificada** pelo servidor em `active`, ' +
        '`expiring_soon` (7 dias), `expired` ou `unknown`.\n\n' +
        'A classificação mudou de casa: era feita dentro do hook da tela. Sendo regra de negócio, ' +
        'é da API — assim a mesma resposta serve a qualquer cliente e não há duas versões da regra.\n\n' +
        '`unknown` significa "sem plano registrado", e é um estado normal, não um erro.',
    }),
    ApiTenantHeaders(),
    ApiResponse({ status: 200, description: 'Estado da licença.' }),
    ApiSessionErrorResponses(),
  );

export const DocPlanWindow = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Janela de histórico permitida pelo plano',
      description:
        'Quantos dias de histórico o plano **ativo** da empresa permite consultar nos relatórios ' +
        '(`module_plans.history_window_days`). `historyWindowDays: null` = sem limite — e é também ' +
        'o fallback quando não há plano ou janela cadastrada, para não bloquear usuário legítimo ' +
        'por falta de cadastro.\n\n' +
        'Diferente de `GET /billing/license`, aqui só conta licença com `is_active = true`: ' +
        'restringir histórico com base numa licença já desativada seria punir por registro morto.',
    }),
    ApiTenantHeaders(),
    ApiResponse({ status: 200, description: 'Janela do plano.' }),
    ApiSessionErrorResponses(),
  );

export const DocPlans = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Catálogo de planos ativos do produto',
      description:
        'Planos ativos de `billing.module_plans` deste módulo, ordenados por `sort_order`. ' +
        'Catálogo do PRODUTO, não da empresa — por isso dispensa `X-Company-Id` (mas exige sessão).\n\n' +
        '**Nunca** devolve `stripe_price_id`/`stripe_product_id`: as colunas são selecionadas uma a ' +
        'uma na consulta, justamente para que acrescentar campo seja uma decisão e não um efeito ' +
        'colateral de `select *`.',
    }),
    ApiResponse({ status: 200, description: 'Catálogo de planos.' }),
    ApiSessionErrorResponses(),
  );
