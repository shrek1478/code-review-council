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

async function bootstrap() {
  await CommandFactory.run(CliModule, { logger: new CliLogger() });
}
bootstrap();
