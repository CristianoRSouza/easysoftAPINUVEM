import { Module } from '@nestjs/common';
import { AgentWriteService } from './application/agent-write.service';
import { DevicesService } from './application/devices.service';
import { PixnopdvWriteService } from './application/pixnopdv-write.service';
import { TotemActivationService } from './application/totem-activation.service';
import { TotemWriteService } from './application/totem-write.service';
import { DevicesController } from './http/devices.controller';
import { DevicesWriteController } from './http/devices-write.controller';
import { AgentsRepository } from './infrastructure/agents.repository';
import { DeviceAuditRepository } from './infrastructure/device-audit.repository';
import { PixnopdvRepository } from './infrastructure/pixnopdv.repository';
import { ProductImagesRepository } from './infrastructure/product-images.repository';
import { TotemLicensesRepository } from './infrastructure/totem-licenses.repository';
import { TotemsRepository } from './infrastructure/totems.repository';

@Module({
  controllers: [DevicesController, DevicesWriteController],
  providers: [
    DevicesService,
    TotemActivationService,
    TotemWriteService,
    AgentWriteService,
    PixnopdvWriteService,
    TotemsRepository,
    TotemLicensesRepository,
    AgentsRepository,
    DeviceAuditRepository,
    PixnopdvRepository,
    ProductImagesRepository,
  ],
})
export class DevicesModule {}
