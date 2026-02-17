#!/usr/bin/env node
import { ConsoleLogger } from '@nestjs/common';
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli/cli.module.js';

const FRAMEWORK_CONTEXTS = new Set([
  'NestFactory',
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
]);

class CliLogger extends ConsoleLogger {
  log(message: any, context?: string): void {
    if (context && FRAMEWORK_CONTEXTS.has(context)) return;
    super.log(message, context);
  }
}

// CopilotClient spawns child processes that register exit/signal listeners on `process`.
// With 3+ reviewers in parallel, this exceeds the default 10 listeners limit.
process.setMaxListeners(30);

async function bootstrap() {
  await CommandFactory.run(CliModule, { logger: new CliLogger() });
}
bootstrap().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
