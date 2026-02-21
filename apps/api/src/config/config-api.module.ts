import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller.js';
import { CouncilConfigModule } from '../../../../src/config/config.module.js';

@Module({
  imports: [CouncilConfigModule],
  controllers: [ConfigController],
})
export class ConfigApiModule {}
