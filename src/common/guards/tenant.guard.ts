import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingHttpHeaders } from 'node:http';
import { IS_PUBLIC, IS_SERVICE_ONLY, IS_SKIP_TENANT, REQUIRES_STORE } from '../decorators';
import { TenantAccessService } from '../tenant/tenant-access.service';
import { UUID_RE } from '../validation/uuid';

/**
 * Valida `X-Company-Id` (e `X-Store-Id`, quando presente ou exigido) contra o acesso
 * real do usuário da sessão.
 *
 * ── Por que o tenant vem em HEADER e não da sessão ──────────────────────────────
 * O Manager tem seletor de empresa/loja e um gestor abre duas lojas em duas abas. Com
 * a loja ativa guardada na sessão do servidor, uma aba mudaria a outra por baixo. O
 * header faz cada requisição dizer por si de qual loja está falando.
 *
 * ── O header NÃO é credencial ───────────────────────────────────────────────────
 * Ele é um ALVO, e só passa depois de o banco confirmar o vínculo. O `userId` sai
 * SEMPRE de `req.user` (posto pelo AuthGuard, que roda antes) — nunca do cliente.
 * Trocar o header para a empresa do vizinho dá 403, não dados do vizinho.
 *
 * ── Falha fechado por padrão ────────────────────────────────────────────────────
 * Rota nova SEM decorator já nasce exigindo tenant. Escapar exige DECLARAR
 * `@SkipTenant()` — o esquecimento vira 400 na cara do desenvolvedor, não um
 * vazamento silencioso entre empresas. Foi para inverter esse ônus que este guard
 * existe: antes, cada service chamava `is_company_admin_for_store` na mão.
 *
 * Erro de banco vira 503 (não 403): infra instável não pode parecer falta de permissão.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly log = new Logger(TenantGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tenant: TenantAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const has = (key: string) =>
      this.reflector.getAllAndOverride<boolean>(key, [ctx.getHandler(), ctx.getClass()]);

    // Rota pública: não há usuário para vincular a empresa nenhuma.
    if (has(IS_PUBLIC)) return true;
    // Máquina-a-máquina (X-Service-Key): cross-tenant por natureza (ex.: provisionamento,
    // fila de sync). O AuthGuard já validou a chave antes de chegar aqui.
    if (has(IS_SERVICE_ONLY)) return true;
    // Opt-out explícito e revisável.
    if (has(IS_SKIP_TENANT)) return true;

    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.id as string | undefined;
    if (!userId) {
      // Só acontece se a ordem dos guards for trocada em app.module.ts — é bug, não 401.
      this.log.error('TenantGuard rodou sem req.user — ordem dos APP_GUARD está errada.');
      throw new ServiceUnavailableException({
        error: 'service_unavailable',
        message: 'Falha ao resolver o contexto da requisição.',
      });
    }

    const companyId = header(req, 'x-company-id');
    if (!companyId) {
      throw new BadRequestException({
        error: 'company_required',
        message: 'Header X-Company-Id ausente.',
      });
    }
    if (!UUID_RE.test(companyId)) {
      throw new BadRequestException({
        error: 'invalid_company',
        message: 'X-Company-Id inválido.',
      });
    }

    const storeIdRaw = header(req, 'x-store-id');
    const requiresStore = has(REQUIRES_STORE) === true;
    if (requiresStore && !storeIdRaw) {
      throw new BadRequestException({
        error: 'store_required',
        message: 'Header X-Store-Id ausente.',
      });
    }
    if (storeIdRaw && !UUID_RE.test(storeIdRaw)) {
      throw new BadRequestException({ error: 'invalid_store', message: 'X-Store-Id inválido.' });
    }
    const storeId = storeIdRaw || null;

    let access;
    try {
      access = await this.tenant.resolve(userId, companyId, storeId);
    } catch (e) {
      this.log.error(`falha ao resolver tenant: ${e instanceof Error ? e.message : String(e)}`);
      throw new ServiceUnavailableException({
        error: 'service_unavailable',
        message: 'Não foi possível validar o acesso agora.',
      });
    }

    if (!access.companyOk) {
      // Mensagem única para "não é membro" e "empresa não existe": responder coisas
      // diferentes transformaria a rota num verificador de existência de empresa.
      throw new ForbiddenException({
        error: 'forbidden',
        message: 'Sem acesso a esta empresa.',
      });
    }

    if (storeId && access.store) {
      const s = access.store;
      const ok =
        s.exists && !s.deleted && s.companyId === companyId && (s.isAdmin || s.hasDirectAccess);
      if (!ok) {
        throw new ForbiddenException({ error: 'forbidden', message: 'Sem acesso a esta loja.' });
      }
      req.storeId = storeId;
      req.isCompanyAdmin = s.isAdmin;
    } else {
      req.storeId = null;
    }

    req.companyId = companyId;
    return true;
  }
}

function header(req: { headers?: IncomingHttpHeaders }, name: string): string {
  const v = req.headers?.[name];
  return (Array.isArray(v) ? v[0] : v ?? '').toString().trim();
}
