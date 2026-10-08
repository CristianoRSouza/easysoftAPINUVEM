import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipTenant } from '../../../common/decorators';
import { ApiSessionAuth } from '../../../common/swagger';
import { CbsService } from '../application/cbs.service';
import {
  DocMunicipalityByUf,
  DocMunicipalityWithRateByUf,
  DocOpenDatasetVersion,
  DocProductFiscalIbsCbs,
  DocTable,
} from './cbs.docs';

const UF_RE = /^[A-Za-z]{2}$/;

/**
 * Tabelas de referência do IBS/CBS (reforma tributária).
 *
 * `@SkipTenant()` em tudo, e isso é decisão, não esquecimento: **não existe `store_id`
 * nem `company_id` em nenhuma destas tabelas** — é legislação, igual para todas as
 * empresas. Exigir `X-Company-Id` para ler a tabela de UFs seria teatro de segurança.
 * A sessão continua obrigatória; o que não faz sentido é o recorte por empresa.
 *
 * As 14 rotas de tabela simples são servidas por um handler só, dirigido pelo catálogo
 * em `cbs.catalog.ts`. Rota nova = uma entrada no catálogo, não um método novo.
 */
@ApiTags('CBS / IBS (referência fiscal)')
@ApiSessionAuth()
@SkipTenant()
@Controller('cbs')
export class CbsController {
  constructor(private readonly service: CbsService) {}

  @Get('open-dataset-version')
  @DocOpenDatasetVersion()
  async openDatasetVersion() {
    return { data: await this.service.openDatasetVersion() };
  }

  @Get('municipality-by-uf')
  @DocMunicipalityByUf()
  async municipalityByUf(@Query('uf') uf: string) {
    return { data: await this.service.municipalitiesByUf(validUf(uf)) };
  }

  @Get('municipality-with-rate-by-uf')
  @DocMunicipalityWithRateByUf()
  async municipalityWithRateByUf(@Query('uf') uf: string) {
    return { data: await this.service.municipalitiesWithRateByUf(validUf(uf)) };
  }

  @Get('product-fiscal-ibscbs')
  @DocProductFiscalIbsCbs()
  async productFiscalIbsCbs(@Query('classCode') classCode: string) {
    const code = String(classCode ?? '').trim();
    if (!code) {
      throw new BadRequestException({
        error: 'missing_class_code',
        message: 'classCode é obrigatório.',
      });
    }
    return { data: await this.service.productFiscalIbsCbs(code) };
  }

  /**
   * As 15 tabelas simples. Fica por ÚLTIMO no controller de propósito: `:key` é um
   * curinga e, se viesse antes, engoliria `open-dataset-version` e as duas de município.
   *
   * `limit`/`stateCode` seguem crus (texto) até o service: chave desconhecida vira 404 lá,
   * e a conversão mora num lugar só (`cbs-query.rule.ts`).
   */
  @Get(':key')
  @DocTable()
  async table(
    @Param('key') key: string,
    @Query('limit') limit?: string,
    @Query('stateCode') stateCode?: string,
  ) {
    return { data: await this.service.table(key, { limit, stateCode }) };
  }
}

function validUf(uf: string): string {
  const v = String(uf ?? '').trim();
  if (!UF_RE.test(v)) {
    throw new BadRequestException({ error: 'invalid_uf', message: 'uf deve ter 2 letras (ex.: SP).' });
  }
  return v;
}
