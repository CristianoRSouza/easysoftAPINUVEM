import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireStore } from '../../../common/decorators';
import { CompanyId, StoreId } from '../../../common/http/request.decorators';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiSessionAuth } from '../../../common/swagger';
import {
  orderItemsQuerySchema,
  ordersQuerySchema,
  transactionsQuerySchema,
  type OrderItemsQuery,
  type OrdersQuery,
  type TransactionsQuery,
} from '../../../contract/operations.schema';
import { revenueQuerySchema, type RevenueQuery } from '../../../contract/revenue.schema';
import { OperationsService } from '../application/operations.service';
import { RevenueService } from '../application/revenue.service';
import {
  DocDashboardStats,
  DocOrderItems,
  DocOrders,
  DocRevenueApproved,
  DocSyncByHour,
  DocTransactions,
  DocTransactionsByDay,
} from './operations.docs';

/**
 * Operação — comandas, itens, transações e dashboard. Todas as rotas são de UMA loja
 * (`@RequireStore`), porque é assim que o dado existe: comanda pertence a uma loja.
 */
@ApiTags('Operação')
@ApiSessionAuth()
@Controller()
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly revenue: RevenueService,
  ) {}

  @Get('orders')
  @RequireStore()
  @DocOrders()
  async orders(
    @StoreId() storeId: string,
    @Query(new ZodValidationPipe(ordersQuerySchema)) query: OrdersQuery,
  ) {
    return { data: await this.operations.listOrders(storeId, query) };
  }

  @Get('order-items')
  @RequireStore()
  @DocOrderItems()
  async orderItems(
    @StoreId() storeId: string,
    @Query(new ZodValidationPipe(orderItemsQuerySchema)) query: OrderItemsQuery,
  ) {
    return { data: await this.operations.listOrderItems(storeId, query) };
  }

  @Get('transactions')
  @RequireStore()
  @DocTransactions()
  async transactions(
    @StoreId() storeId: string,
    @Query(new ZodValidationPipe(transactionsQuerySchema)) query: TransactionsQuery,
  ) {
    return { data: await this.operations.listTransactions(storeId, query) };
  }

  @Get('dashboard/stats')
  @RequireStore()
  @DocDashboardStats()
  async dashboardStats(@CompanyId() companyId: string, @StoreId() storeId: string) {
    return { data: await this.operations.dashboardStats(companyId, storeId) };
  }

  @Get('dashboard/transactions-by-day')
  @RequireStore()
  @DocTransactionsByDay()
  async transactionsByDay(@StoreId() storeId: string) {
    return { data: await this.operations.transactionsByDay(storeId) };
  }

  @Get('dashboard/revenue-approved')
  @RequireStore()
  @DocRevenueApproved()
  async revenueApproved(
    @StoreId() storeId: string,
    @Query(new ZodValidationPipe(revenueQuerySchema)) query: RevenueQuery,
  ) {
    return { data: await this.revenue.report(storeId, query) };
  }

  @Get('dashboard/sync-by-hour')
  @RequireStore()
  @DocSyncByHour()
  async syncByHour() {
    return { data: await this.operations.syncByHour() };
  }
}
