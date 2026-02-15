import { Module, Global, ConsoleLogger, Scope } from '@nestjs/common';
import { AcpService } from './acp.service.js';

@Global()
@Module({
  providers: [
    { provide: ConsoleLogger, useClass: ConsoleLogger, scope: Scope.TRANSIENT },
    AcpService,
  ],
  exports: [AcpService],
})
export class AcpModule {}
