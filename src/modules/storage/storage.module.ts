import { Module } from '@nestjs/common';
import { StorageService } from './application/storage.service';
import { StorageController } from './http/storage.controller';
import { StorageBucketClient } from './infrastructure/storage-bucket.client';

@Module({
  controllers: [StorageController],
  providers: [StorageService, StorageBucketClient],
})
export class StorageModule {}
