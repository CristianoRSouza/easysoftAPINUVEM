import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { UUID_RE } from '../../../common/validation/uuid';
import { ENV, type Env } from '../../../config/env';
import {
  EMAIL_RE,
  expiresAtSeconds,
  resolveTtlHours,
  signBootstrapCode,
  type BootstrapCodePayload,
} from '../domain/bootstrap-code';
import { StoreAdminRepository } from '../../../common/tenant/store-admin.repository';

/**
 * Migra issue-bootstrap-code: gera um "código de primeiro acesso" assinado que a
 * Admin-API local verifica OFFLINE. O formato (imutável) está em `domain/bootstrap-code.ts`.
 * Autoriza só admin da loja (RPC is_company_admin_for_store).
 */
@Injectable()
export class StoresService {
  constructor(
    private readonly storeAdmin: StoreAdminRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async issueBootstrapCode(callerId: string, storeIdRaw: string, emailRaw: string, ttlHoursRaw?: number) {
    if (!this.env.SENSITIVE_SECRET_MASTER_KEY_BASE64) {
      throw new InternalServerErrorException({ error: 'not_configured', message: 'SENSITIVE_SECRET_MASTER_KEY_BASE64 ausente.' });
    }
    const email = String(emailRaw ?? '').trim().toLowerCase();
    const storeId = String(storeIdRaw ?? '').trim();
    if (!EMAIL_RE.test(email)) throw new BadRequestException({ error: 'invalid_email', message: 'Email inválido.' });
    if (!UUID_RE.test(storeId)) throw new BadRequestException({ error: 'invalid_store', message: 'store_id inválido.' });

    const ttlHours = resolveTtlHours(ttlHoursRaw);

    // Autoriza: só admin da loja. A regra vem de `podeAdministrarLoja` — antes esta linha
    // chamava `is_company_admin_for_store` sozinha, e por isso um system_admin (que não
    // tem linha em pb_user_company_access) levava 403 ao gerar código.
    if (!(await this.storeAdmin.canAdminister(callerId, storeId))) {
      throw new ForbiddenException({ error: 'forbidden', message: 'Sem permissão para gerar código nesta loja.' });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const exp = expiresAtSeconds(nowSec, ttlHours);
    const jti = crypto.randomUUID();
    const code = this.signCode({ v: 1, em: email, sid: storeId, exp, jti });
    return { ok: true, code, email, store_id: storeId, expires_at: new Date(exp * 1000).toISOString() };
  }

  /** Confere a chave-mestra (fail-closed: 32 bytes ou nada) e assina. */
  private signCode(payload: BootstrapCodePayload): string {
    const master = Buffer.from(this.env.SENSITIVE_SECRET_MASTER_KEY_BASE64.trim(), 'base64');
    if (master.length !== 32) {
      throw new InternalServerErrorException({ error: 'bad_key', message: 'Master key deve ter 32 bytes.' });
    }
    return signBootstrapCode(payload, master);
  }
}
