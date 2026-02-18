import { Module, Global, ConsoleLogger, Scope } from '@nestjs/common';
import { ConfigService } from './config.service.js';

@Global()
@Module({
  providers: [
    { provide: ConsoleLogger, useClass: ConsoleLogger, scope: Scope.TRANSIENT },
    ConfigService,
  ],
  exports: [ConfigService],
})
export class CouncilConfigModule {}
