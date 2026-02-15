import { Module, Global, ConsoleLogger } from '@nestjs/common';
import { AcpService } from './acp.service.js';

@Global()
@Module({
  providers: [ConsoleLogger, AcpService],
  exports: [AcpService],
})
export class AcpModule {}
