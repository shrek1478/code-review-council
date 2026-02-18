import { Module, Global, ConsoleLogger } from '@nestjs/common';
import { ConfigService } from './config.service.js';

@Global()
@Module({
  providers: [ConsoleLogger, ConfigService],
  exports: [ConfigService],
})
export class CouncilConfigModule {}
