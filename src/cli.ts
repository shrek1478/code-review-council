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
// With multiple reviewers in parallel, this exceeds the default 10 listeners limit.
// Formula: Node.js default (10) + max concurrent clients (reviewers + decision maker) * listeners per client.
const BASE_LISTENERS = 10;
const LISTENERS_PER_CLIENT = 4;
const MAX_CONCURRENT_CLIENTS = 5;
process.setMaxListeners(BASE_LISTENERS + MAX_CONCURRENT_CLIENTS * LISTENERS_PER_CLIENT);

async function bootstrap() {
  await CommandFactory.run(CliModule, { logger: new CliLogger() });
}
bootstrap().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
