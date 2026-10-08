import { Module } from '@nestjs/common';
import { NfceService } from './application/nfce.service';
import { NfceXmlController } from './http/nfce-xml.controller';
import { NfceController } from './http/nfce.controller';
import { NfceXmlStorageClient } from './infrastructure/nfce-xml-storage.client';
import { NfceXmlRepository } from './infrastructure/nfce-xml.repository';
import { NfceRepository } from './infrastructure/nfce.repository';

@Module({
  controllers: [NfceController, NfceXmlController],
  providers: [NfceService, NfceRepository, NfceXmlRepository, NfceXmlStorageClient],
})
export class NfceModule {}
