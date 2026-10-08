import { Injectable } from '@nestjs/common';
import type {
  DashboardStats,
  Order,
  OrderItem,
  OrderItemsQuery,
  OrdersQuery,
  SyncByHour,
  Transaction,
  TransactionsByDay,
  TransactionsQuery,
} from '../../../contract/operations.schema';
import {
  mapDashboardStats,
  mapOrder,
  mapOrderItem,
  mapTransaction,
  mapTransactionsByDay,
} from '../domain/operations.mapper';
import { OperationsRepository } from '../infrastructure/operations.repository';

/**
 * Operação na nuvem: comandas, itens, transações e os números do dashboard.
 *
 * Cada método é um caso de uso de leitura: busca no repositório e entrega na forma do
 * fio. O SQL (e a nota de fuso das datas) está em `OperationsRepository`; o que cada
 * campo vira quando ausente, em `operations.mapper.ts`.
 */
@Injectable()
export class OperationsService {
  constructor(private readonly repository: OperationsRepository) {}

  async listOrders(storeId: string, query: OrdersQuery): Promise<Order[]> {
    return (await this.repository.findOrders(storeId, query)).map(mapOrder);
  }

  async listOrderItems(storeId: string, query: OrderItemsQuery): Promise<OrderItem[]> {
    return (await this.repository.findOrderItems(storeId, query)).map(mapOrderItem);
  }

  async listTransactions(storeId: string, query: TransactionsQuery): Promise<Transaction[]> {
    return (await this.repository.findTransactions(storeId, query)).map(mapTransaction);
  }

  async dashboardStats(companyId: string, storeId: string): Promise<DashboardStats> {
    return mapDashboardStats(await this.repository.countDashboard(companyId, storeId));
  }

  async transactionsByDay(storeId: string): Promise<TransactionsByDay> {
    return mapTransactionsByDay(await this.repository.sumTransactionsByDay(storeId));
  }

  /**
   * Sincronizações por hora — **sempre vazio na nuvem, e isso é a resposta certa**.
   * `command.sync_log` foi REMOVIDA do Supabase; o painel só faz sentido com o
   * PostgreSQL da loja. A rota existe para a tela ter um só formato nos dois modos.
   */
  async syncByHour(): Promise<SyncByHour> {
    return [];
  }
}
