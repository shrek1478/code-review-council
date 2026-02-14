import { Module } from '@nestjs/common';
import { CouncilConfigModule } from '../config/config.module.js';
import { AcpModule } from '../acp/acp.module.js';
import { ReviewModule } from '../review/review.module.js';
import { DiffCommand } from './diff.command.js';
import { FileCommand } from './file.command.js';
import { CodebaseCommand } from './codebase.command.js';

@Module({
  imports: [CouncilConfigModule, AcpModule, ReviewModule],
  providers: [DiffCommand, FileCommand, CodebaseCommand],
})
export class CliModule {}
