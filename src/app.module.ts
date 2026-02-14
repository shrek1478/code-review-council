import { Module } from '@nestjs/common';
import { CouncilConfigModule } from './config/config.module.js';
import { AcpModule } from './acp/acp.module.js';
import { ReviewModule } from './review/review.module.js';

@Module({
  imports: [CouncilConfigModule, AcpModule, ReviewModule],
})
export class AppModule {}
