import { Module, Global } from '@nestjs/common';
import { ConfigService } from './config.service.js';

@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class CouncilConfigModule {}
