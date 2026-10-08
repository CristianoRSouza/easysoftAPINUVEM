import { toIso } from '../../../common/mapping/coerce';
import type { LicenseState, LicenseStatus } from '../../../contract/billing.schema';
import type { Row } from '../../../db/queryable';

/** Dias que fazem a licença entrar em "expira em breve" (mesmo valor que a tela usava). */
export const EXPIRING_SOON_DAYS = 7;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Estado da licença da empresa, já classificado.
 *
 * A regra (herdada de `useLicenseStatus`, agora no servidor):
 *   • sem plano registrado            → `unknown` (silencioso, não é erro)
 *   • `expires_at` no passado         → `expired`
 *   • `is_active = false`             → `expired` (força revisão mesmo sem data vencida)
 *   • expira em até 7 dias            → `expiring_soon`
 *   • caso contrário                  → `active`
 *
 * `row` é a licença mais recente da empresa (ou `undefined` se não há nenhuma) e `now` é o
 * instante de referência em ms — recebido de fora para a regra continuar pura.
 */
export function classifyLicense(row: Row | undefined, now: number): LicenseStatus {
  const planSlug = row?.plan_name != null ? String(row.plan_name) : null;
  const expiresAt = row?.expires_at != null ? toIso(row.expires_at) : null;
  const isActive = row?.is_active != null ? Boolean(row.is_active) : null;
  const planName = row?.plan_display_name != null ? String(row.plan_display_name) : null;

  const exp = expiresAt ? new Date(expiresAt).getTime() : null;
  const daysUntilExpiry =
    exp != null && Number.isFinite(exp) ? Math.ceil((exp - now) / MS_PER_DAY) : null;

  let state: LicenseState;
  if (!planSlug) state = 'unknown';
  else if (exp != null && exp < now) state = 'expired';
  else if (isActive === false) state = 'expired';
  else if (daysUntilExpiry != null && daysUntilExpiry <= EXPIRING_SOON_DAYS) state = 'expiring_soon';
  else state = 'active';

  return { state, planSlug, planName, expiresAt, isActive, daysUntilExpiry };
}
