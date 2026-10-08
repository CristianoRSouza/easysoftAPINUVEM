import { Injectable, Logger } from '@nestjs/common';
import { DbService } from './db.service';

/**
 * Ponto de OBSERVABILIDADE de operações privilegiadas — NÃO é um controle de
 * segurança. O privilégio real vem do role do `DATABASE_URL` (use um role de
 * MENOR PRIVILÉGIO — ver sql/least-privilege-role.sql — não `postgres`) e da
 * service_role do Supabase (Auth admin). Aqui só rotulamos/contamos as escalações
 * por um motivo de enum FECHADO, pra revisão e métrica — não confie nisso como
 * fronteira: ele não troca de role nem escopa nada.
 */
export type ServiceRoleReason =
  | 'provision-tenant' // upsert de empresa/lojas/usuários/keys (transação)
  | 'auth-admin' // GoTrue admin (criar usuário / generateLink)
  | 'auth-session' // criar sessão opaca no login
  | 'rbac-authz' // checar autorização (ex.: is_company_admin_for_store)
  | 'storage'; // upload ao Storage (imagens de produto / PFX NFC-e) — Fase 2 do cutover

@Injectable()
export class ServiceRole {
  private readonly log = new Logger('service-role');
  private readonly counts = new Map<ServiceRoleReason, number>();

  constructor(private readonly db: DbService) {}

  /** Única porta para operações privilegiadas. `reason` é grepável e contado. */
  async run<T>(reason: ServiceRoleReason, fn: (db: DbService) => Promise<T>): Promise<T> {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
    this.log.debug(`service_role: ${reason}`);
    return fn(this.db);
  }

  /** Métrica de dívida (exponível num /health): quantas escalações por motivo. */
  stats(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}
