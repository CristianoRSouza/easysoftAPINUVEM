import { Injectable } from '@nestjs/common';
import { toInt } from '../../../common/mapping/coerce';
import type { RevenueQuery, RevenueReport } from '../../../contract/revenue.schema';
import {
  mapByDay,
  mapByHour,
  mapByMonth,
  mapByProduct,
  mapByTotem,
  pageOfRecent,
  resolvePeriod,
  summarize,
  totalsByMethod,
} from '../domain/revenue-report';
import { RevenueRepository, type RevenueScope } from '../infrastructure/revenue.repository';

/**
 * Receita aprovada — monta o relatório a partir de oito agregações.
 *
 * As consultas são independentes e vão em paralelo. Não estão numa transação: são
 * leituras de um relatório, e um `begin/commit` só serviria para segurar conexão do pool
 * por mais tempo. O custo é teórico — uma venda entrando no meio pode aparecer num
 * recorte e não em outro; o ganho é não prender o pool durante oito agregações.
 */
@Injectable()
export class RevenueService {
  constructor(private readonly repository: RevenueRepository) {}

  async report(storeId: string, query: RevenueQuery): Promise<RevenueReport> {
    const period = resolvePeriod(query);
    const scope: RevenueScope = { storeId, ...period };
    const { recentOffset: offset, recentLimit: limit } = query;

    const [methodRows, byDay, byHour, byTotem, byProduct, byMonth, nfceIssued, recentRows] =
      await Promise.all([
        this.repository.totalsByMethod(scope),
        this.repository.byDay(scope),
        this.repository.byHour(scope),
        this.repository.byTotem(scope),
        this.repository.byProductTop10(scope),
        this.repository.byMonthYoY(scope),
        this.repository.countNfceIssued(scope),
        // Uma linha a mais que a página: ver `pageOfRecent`.
        this.repository.findRecentApproved(scope, limit + 1, offset),
      ]);

    const byMethod = totalsByMethod(methodRows);
    const recent = pageOfRecent(recentRows, limit);

    return {
      period,
      byMethod,
      ...summarize(byMethod, toInt(nfceIssued)),
      byHour: mapByHour(byHour),
      recentApproved: recent.rows,
      recentApprovedMeta: { offset, limit, hasMore: recent.hasMore },
      byTotem: mapByTotem(byTotem),
      byProductTop10: mapByProduct(byProduct),
      byMonthYoY: mapByMonth(byMonth),
      byDay: mapByDay(byDay),
    };
  }
}
