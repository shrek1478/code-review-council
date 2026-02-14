import { Module, Global } from '@nestjs/common';
import { AcpService } from './acp.service.js';

@Global()
@Module({
  providers: [AcpService],
  exports: [AcpService],
})
export class AcpModule {}
