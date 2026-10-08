import { ForbiddenException, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { encryptEnvelopeV1 } from '../../../common/crypto/envelope';
import { ENV, type Env } from '../../../config/env';
import { StoreAdminRepository } from '../../../common/tenant/store-admin.repository';

/**
 * Migra encrypt-totem-tef-secrets: cifra segredos TEF Aditum no envelope
 * `enc:v1:<iv_b64>:<tag_b64>:<data_b64>` (AES-256-GCM, IV 12B) — MESMO formato do
 * Electron. AUTORIZA só admin da loja (a cifra usa a master key COMPARTILHADA, então
 * não pode ser um oráculo aberto a qualquer usuário logado).
 */
@Injectable()
export class TotemsService {
  constructor(
    private readonly storeAdmin: StoreAdminRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async encryptTefSecrets(callerId: string, storeId: string, partner?: string | null, ativation?: string | null) {
    if (!this.env.SENSITIVE_SECRET_MASTER_KEY_BASE64) {
      throw new InternalServerErrorException({
        error: 'not_configured',
        message: 'SENSITIVE_SECRET_MASTER_KEY_BASE64 ausente.',
      });
    }

    // Autoriza: só admin da loja pode cifrar segredos TEF desta loja. A regra vem de
    // `podeAdministrarLoja` — `is_company_admin_for_store` sozinha barrava o system_admin.
    if (!(await this.storeAdmin.canAdminister(callerId, storeId))) {
      throw new ForbiddenException({ error: 'forbidden', message: 'Sem permissão para esta loja.' });
    }

    const kid = this.env.SENSITIVE_SECRET_KEY_ID;
    const result: Record<string, string | null> = {
      partner_token_encrypted: null,
      partner_token_kid: null,
      ativation_code_encrypted: null,
      ativation_code_kid: null,
    };
    if (typeof partner === 'string' && partner.trim() !== '') {
      result.partner_token_encrypted = this.encryptEnvelopeV1(partner);
      result.partner_token_kid = kid;
    }
    if (typeof ativation === 'string' && ativation.trim() !== '') {
      result.ativation_code_encrypted = this.encryptEnvelopeV1(ativation);
      result.ativation_code_kid = kid;
    }
    return { ok: true, kid, ...result };
  }

  private encryptEnvelopeV1(plain: string): string {
    return encryptEnvelopeV1(plain, this.env.SENSITIVE_SECRET_MASTER_KEY_BASE64);
  }
}
