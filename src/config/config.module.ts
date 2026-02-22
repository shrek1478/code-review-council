import {
  Module,
  Global,
  ConsoleLogger,
  Scope,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from './config.service.js';

@Global()
@Module({
  providers: [
    { provide: ConsoleLogger, useClass: ConsoleLogger, scope: Scope.TRANSIENT },
    ConfigService,
  ],
  exports: [ConfigService],
})
export class CouncilConfigModule implements OnModuleInit {
  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.configService.loadConfig();
  }
}
