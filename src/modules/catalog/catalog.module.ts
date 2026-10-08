import { Module } from '@nestjs/common';
import { CatalogService } from './application/catalog.service';
import { CatalogController } from './http/catalog.controller';
import { CatalogRepository } from './infrastructure/catalog.repository';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, CatalogRepository],
})
export class CatalogModule {}
