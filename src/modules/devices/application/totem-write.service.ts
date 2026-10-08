import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { encryptEnvelopeV1 } from '../../../common/crypto/envelope';
import { ENV, type Env } from '../../../config/env';
import type { TotemCreateInput, TotemUpdateInput } from '../../../contract/totem-write.schema';
import { diffDeAuditoria } from '../domain/audit-diff';
import { configPermitida, pedeProducao } from '../domain/totem-license.rule';
import {
  colunasCifradas,
  segredosTefParaGravar,
  semSegredos,
  type SegredoCifrado,
} from '../domain/totem-tef-secrets.rule';
import {
  ambientesDepoisDeSalvar,
  camposDeCriacao,
  camposDeEdicao,
} from '../domain/totem-write.mapper';
import { TotemLicensesRepository } from '../infrastructure/totem-licenses.repository';
import { TotemsRepository } from '../infrastructure/totems.repository';

/**
 * Escritas de dispositivos — criação e edição da configuração de totem.
 *
 * ── A regra desta classe ──────────────────────────────────────────────────────
 * Nenhum método aceita `companyId` vindo do cliente: ele chega do `TenantGuard`, que já
 * conferiu o vínculo no banco. E **todo comando leva o tenant no `WHERE`**, não só o id.
 *
 * Isso corrige, na origem, os 7 casos que a varredura do `cloud-data.ts` encontrou:
 *
 *     .update({ ... }).eq("id", id)      // e nada mais
 *
 * No navegador aquilo era seguro porque a RLS barrava a linha de outra empresa. O role
 * desta API tem `BYPASSRLS`: copiar o padrão deixaria qualquer usuário logado desativar
 * o agente de NFC-e de um concorrente — ou seja, parar a emissão de nota na loja dele.
 *
 * Ligar/desligar e reenfileirar (as escritas por RPC) estão em `TotemActivationService`;
 * agentes e PIXnoPDV, em `AgentWriteService` e `PixnopdvWriteService`.
 */
@Injectable()
export class TotemWriteService {
  // O contexto do log continua o da classe de origem: é por ele que se filtra o histórico.
  private readonly log = new Logger('DevicesWriteService');

  constructor(
    private readonly totems: TotemsRepository,
    private readonly licenses: TotemLicensesRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Cifra um segredo TEF com a chave mestra do servidor. Recusa (400) quando ela não está
   * configurada — e só é chamada quando há texto a cifrar, então limpar um segredo ou não
   * mexer nele continua funcionando sem a chave.
   */
  private readonly cifrarSegredoTef = (texto: string): SegredoCifrado => {
    if (!this.env.SENSITIVE_SECRET_MASTER_KEY_BASE64) {
      throw new BadRequestException({
        error: 'not_configured',
        message: 'Cifra de segredos TEF indisponível: SENSITIVE_SECRET_MASTER_KEY_BASE64 ausente.',
      });
    }
    return {
      cifrado: encryptEnvelopeV1(texto, this.env.SENSITIVE_SECRET_MASTER_KEY_BASE64),
      kid: this.env.SENSITIVE_SECRET_KEY_ID,
    };
  };

  /**
   * Cria a configuração de um totem.
   *
   * `company_id`/`store_id` saem da SESSÃO — o navegador os monta a partir do
   * `localStorage`, e aceitar isso deixaria o cliente gravar em nome de outra empresa.
   *
   * **Nasce sempre inativo**, como no navegador, e por um motivo de banco: o gatilho recusa
   * totem ativo sem licença, e a licença só é vinculada pela RPC de ativação. Quem pediu
   * `is_active: true` ativa no passo seguinte, com a licença junto — uma chamada a
   * `PATCH /totems/:id/active`. A resposta diz `precisa_ativar` para a tela saber disso.
   *
   * A auditoria vai na MESMA transação do insert: totem gravado sem rastro de quem o criou
   * é pior que falhar os dois.
   */
  async createTotem(
    companyId: string,
    storeId: string | null,
    input: TotemCreateInput,
    quem: string,
  ) {
    // A licença só é consultada quando algum campo pede produção — no caminho comum não há
    // pergunta a fazer, e ir ao billing à toa é ida ao banco que ninguém precisa.
    if (pedeProducao(input)) {
      const permitido = configPermitida(
        input,
        await this.licenses.findParaRegra(input.license_id ?? null),
        false,
      );
      if (!permitido.ok) {
        throw new BadRequestException({ error: 'demo_license', message: permitido.error });
      }
    }

    const rec = input as Record<string, unknown>;
    const campos = camposDeCriacao(input);
    const valores: unknown[] = campos.map((k) => rec[k]);

    const tef = segredosTefParaGravar(input, this.cifrarSegredoTef);
    campos.push(...tef.campos);
    valores.push(...tef.valores);

    // is_active fora do payload de propósito: quem liga o totem é a RPC.
    campos.push('is_active');
    valores.push(false);

    return this.totems.emTransacao(async (c) => {
      const id = await this.totems.insert(c, companyId, storeId, campos, valores);
      await this.totems.insertAuditCreated(
        c,
        companyId,
        storeId,
        id,
        campos,
        semSegredos(input),
        quem,
      );

      this.log.log(`totem criado ${id.slice(0, 8)} (empresa ${companyId.slice(0, 8)})`);
      return { ok: true, id, precisa_ativar: input.is_active === true };
    });
  }

  /**
   * Edita a configuração de um totem.
   *
   * O tenant entra no `WHERE`, não só o id — é a correção do `.update({...}).eq("id", id)`
   * do navegador, que só era seguro lá porque a RLS barrava a linha alheia. O role desta
   * API tem `BYPASSRLS`.
   *
   * `is_active` não é gravado por aqui nem quando vem no corpo: ligar/desligar é da RPC,
   * que cuida do vínculo de licença junto. A resposta avisa em `precisa_ativar`.
   */
  async updateTotem(companyId: string, totemId: string, input: TotemUpdateInput, quem: string) {
    const rec = input as Record<string, unknown>;
    const campos = camposDeEdicao(input);
    const tef = segredosTefParaGravar(input, this.cifrarSegredoTef);

    if (campos.length === 0 && tef.campos.length === 0) {
      return { ok: true, changed: [] as string[], precisa_ativar: false };
    }

    return this.totems.emTransacao(async (c) => {
      // O SELECT já carrega o tenant: se não for da empresa, para aqui — e carrega a
      // config atual, porque a regra de licença julga o resultado FINAL, não só o que veio
      // no corpo. Mandar `nfce_environment: 1` sozinho tem de ser barrado igual.
      const prev = await this.totems.findParaEdicao(c, companyId, totemId, campos);
      if (!prev) {
        throw new ForbiddenException({
          error: 'forbidden',
          message: 'Totem não pertence a esta empresa.',
        });
      }

      const final = ambientesDepoisDeSalvar(input, prev);
      // Só vai ao billing quando o resultado final pede produção. Consultar sempre seria
      // uma ida a mais ao banco em toda edição, para responder pergunta que não foi feita.
      if (pedeProducao(final)) {
        const licenca =
          input.license_id !== undefined
            ? await this.licenses.findParaRegra(input.license_id, c)
            : await this.licenses.findDoTotem(totemId, c);
        const permitido = configPermitida(final, licenca, false);
        if (!permitido.ok) {
          throw new BadRequestException({ error: 'demo_license', message: permitido.error });
        }
      }

      const gravados = await this.totems.update(
        c,
        companyId,
        totemId,
        [...campos, ...tef.campos],
        [...campos.map((k) => rec[k]), ...tef.valores],
      );
      if (gravados.length === 0) {
        throw new ForbiddenException({
          error: 'forbidden',
          message: 'Totem não pertence a esta empresa.',
        });
      }

      // O diff cobre só os campos comuns — segredo TEF fica de fora de propósito, porque
      // gravar "de/para" de segredo na auditoria é vazar o segredo na auditoria.
      const { mudou, de, para } = diffDeAuditoria(campos, prev, rec);
      const tefMudou = colunasCifradas(tef);
      const registrar = [...mudou, ...tefMudou];

      if (registrar.length > 0) {
        for (const k of tefMudou) {
          de[k] = '***';
          para[k] = '***';
        }
        await this.totems.insertAuditUpdated(c, companyId, totemId, registrar, de, para, quem);
      }

      this.log.log(`totem ${totemId.slice(0, 8)} atualizado: ${registrar.join(', ') || '(nada)'}`);
      return { ok: true, changed: registrar, precisa_ativar: input.is_active === true };
    });
  }
}
