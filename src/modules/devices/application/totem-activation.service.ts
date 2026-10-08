import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { TotemActiveInput } from '../../../contract/devices-write.schema';
import { configPermitida } from '../domain/totem-license.rule';
import { TotemLicensesRepository } from '../infrastructure/totem-licenses.repository';
import { TotemsRepository } from '../infrastructure/totems.repository';
import { recusaDaRpcDeTotem } from './totem-rpc-refusal.mapper';

/**
 * Ativação e reenfileiramento de totem — as duas escritas que passam por RPC.
 *
 * As duas RPCs usadas aqui (`cloud_set_totem_active`, `cloud_requeue_totem_sync`) recebem
 * **só o id do totem** — não têm recorte de tenant. Por isso o vínculo é conferido ANTES
 * de chamá-las, e a checagem devolve 403.
 *
 * Nenhum método aceita `companyId` vindo do cliente: ele chega do `TenantGuard`, que já
 * conferiu o vínculo no banco.
 */
@Injectable()
export class TotemActivationService {
  // O contexto do log continua o da classe de origem: é por ele que se filtra o histórico.
  private readonly log = new Logger('DevicesWriteService');

  constructor(
    private readonly totems: TotemsRepository,
    private readonly licenses: TotemLicensesRepository,
  ) {}

  /**
   * O totem é desta empresa? Porta de entrada de toda escrita de totem.
   * Lança 403 — nunca deixa passar "por omissão".
   */
  private async assertTotemDaEmpresa(companyId: string, totemId: string): Promise<void> {
    if (!(await this.totems.pertenceAEmpresa(companyId, totemId))) {
      throw new ForbiddenException({
        error: 'forbidden',
        message: 'Totem não pertence a esta empresa.',
      });
    }
  }

  /**
   * Ativa/desativa um totem via RPC.
   *
   * A RPC recebe só o id, então a checagem de empresa acontece antes — sem ela, um id
   * alheio desativaria o totem de outra loja.
   *
   * `license_id` **ausente** e `license_id: null` são coisas diferentes: ausente não mexe
   * no vínculo, `null` desvincula. O gatilho do banco recusa totem ativo sem licença,
   * então confundir os dois leva a resultados opostos.
   */
  async setTotemActive(
    companyId: string,
    totemId: string,
    input: TotemActiveInput,
    userId: string,
  ) {
    await this.assertTotemDaEmpresa(companyId, totemId);
    const mexeNaLicenca = 'license_id' in input;
    // Ativar SEM licença informada usa a que já está vinculada ao totem. O caso comum é o
    // "Novo Totem": o gatilho `ensure_demo_license_for_totem` cria e vincula uma demo no
    // INSERT, a tela não sabe o id dela e manda `license_id: null` — e a RPC recusava com
    // `license_required_for_active_totem`, que chegava à tela como "Erro interno" com o
    // totem já criado (30/09/2026). Informar uma licença continua vencendo.
    const licenseId =
      (mexeNaLicenca ? (input.license_id ?? null) : null) ??
      (input.is_active ? await this.licenses.findIdAtivaDoTotem(totemId) : null);

    // Ativar é o momento em que o totem passa a operar de verdade — então é aqui que a
    // regra de licença tem de valer, não só na tela de configuração. A RPC confere se a
    // licença existe, está ativa e é da empresa; ela NÃO confere se é demo.
    if (input.is_active) {
      const cfg = await this.totems.findAmbientes(companyId, totemId);
      const permitido = configPermitida(
        cfg ?? {},
        await this.licenses.findParaRegra(licenseId),
        false,
      );
      if (!permitido.ok) {
        throw new BadRequestException({ error: 'demo_license', message: permitido.error });
      }
    }

    let resultado: unknown;
    try {
      resultado = await this.totems.setActiveViaRpc(userId, totemId, input.is_active, licenseId);
    } catch (e) {
      throw recusaDaRpcDeTotem(e) ?? e;
    }

    this.log.log(
      `totem ${totemId.slice(0, 8)} is_active=${input.is_active} (empresa ${companyId.slice(0, 8)})`,
    );
    return resultado ?? { ok: true };
  }

  /** Reenfileira a sincronização do totem. Mesma amarra: empresa conferida antes da RPC. */
  async requeueTotemSync(companyId: string, totemId: string, userId: string) {
    await this.assertTotemDaEmpresa(companyId, totemId);
    return (await this.totems.requeueSyncViaRpc(userId, totemId)) ?? { ok: true };
  }
}
