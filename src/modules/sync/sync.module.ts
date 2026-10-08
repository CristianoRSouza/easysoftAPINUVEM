import { Module } from '@nestjs/common';
import { SyncService } from './application/sync.service';
import { SyncController } from './http/sync.controller';
import { SyncRepository } from './infrastructure/sync.repository';

@Module({ controllers: [SyncController], providers: [SyncService, SyncRepository] })
export class SyncModule {}
