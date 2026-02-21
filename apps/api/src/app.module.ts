import { Module } from '@nestjs/common';
import { AcpModule } from '../../../src/acp/acp.module.js';
import { ReviewApiModule } from './review/review-api.module.js';
import { ConfigApiModule } from './config/config-api.module.js';

@Module({
  imports: [AcpModule, ReviewApiModule, ConfigApiModule],
})
export class AppModule {}
