import { Module } from '@nestjs/common';
import { SyncPanelService } from './application/sync-panel.service';
import { SyncPanelController } from './http/sync-panel.controller';
import { SyncPanelRepository } from './infrastructure/sync-panel.repository';

@Module({
  controllers: [SyncPanelController],
  providers: [SyncPanelService, SyncPanelRepository],
})
export class SyncPanelModule {}
