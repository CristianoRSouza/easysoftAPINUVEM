import { Injectable } from '@nestjs/common';
import type { PixnopdvPutInput } from '../../../contract/devices-write.schema';
import {
  credenciaisPixnopdvSemSegredos,
  mesclarCredenciaisPixnopdv,
} from '../domain/pixnopdv-credentials';
import { PixnopdvRepository } from '../infrastructure/pixnopdv.repository';

/** Escrita das credenciais do PIXnoPDV de uma loja. */
@Injectable()
export class PixnopdvWriteService {
  constructor(private readonly pixnopdv: PixnopdvRepository) {}

  /**
   * Salva as credenciais do PIXnoPDV.
   *
   * A regra de mescla — a PRESENÇA da chave decide, não o valor — está em
   * `mesclarCredenciaisPixnopdv`; leia o aviso de lá antes de mexer aqui.
   */
  async savePixnopdv(companyId: string, storeId: string, input: PixnopdvPutInput) {
    const prev = await this.pixnopdv.findGravadas(companyId, storeId);
    const merged = mesclarCredenciaisPixnopdv(input, prev);
    const gravadoEm = await this.pixnopdv.upsert(companyId, storeId, merged);

    return credenciaisPixnopdvSemSegredos(gravadoEm ?? storeId, merged);
  }
}
