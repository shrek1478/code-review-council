import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject } from '@nestjs/common';
import { existsSync, statSync } from 'node:fs';
import { ReviewService } from '../review/review.service.js';
import { ConfigService } from '../config/config.service.js';
import { printResult, sanitize, parseChecksOption } from './result-printer.js';

@Command({ name: 'codebase', description: 'Review entire codebase' })
export class CodebaseCommand extends CommandRunner {
  constructor(
    @Inject(ReviewService) private readonly reviewService: ReviewService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(_params: string[], options: Record<string, string>): Promise<void> {
    await this.configService.loadConfig(options.config);

    const directory = options.dir ?? process.cwd();
    const extensions =
      options.extensions
        ?.split(',')
        .map((e) => e.trim())
        .filter(Boolean) ?? undefined;
    const parsedBatchSize = options.batchSize
      ? Number.parseInt(options.batchSize, 10)
      : undefined;
    if (
      parsedBatchSize !== undefined &&
      (Number.isNaN(parsedBatchSize) || parsedBatchSize <= 0)
    ) {
      throw new Error(
        `Invalid batch-size: "${options.batchSize}". Must be a positive integer.`,
      );
    }
    const config = this.configService.getConfig();
    const checks = parseChecksOption(
      options.checks,
      new Set(config.review.defaultChecks),
    );
    const extra = options.extra;

    console.log('\n=== Code Review Council ===\n');
    console.log(`Directory: ${sanitize(directory)}`);
    if (extensions) console.log(`Extensions: ${extensions.join(', ')}`);
    if (parsedBatchSize) console.log(`Batch size: ${parsedBatchSize}`);
    console.log('Reviewing...\n');

    const result = await this.reviewService.reviewCodebase(
      directory,
      { extensions, maxBatchSize: parsedBatchSize },
      checks,
      extra,
    );

    printResult(result);
  }

  @Option({
    flags: '--dir <path>',
    description: 'Directory to review (default: cwd)',
  })
  parseDir(val: string) {
    if (!existsSync(val)) {
      throw new Error(`Directory not found: "${val}"`);
    }
    if (!statSync(val).isDirectory()) {
      throw new Error(`Not a directory: "${val}"`);
    }
    return val;
  }

  @Option({
    flags: '--extensions <list>',
    description: 'Comma-separated file extensions (e.g. ts,js,py)',
  })
  parseExtensions(val: string) {
    return val;
  }

  @Option({
    flags: '--batch-size <chars>',
    description: 'Max characters per batch (default: 100000)',
  })
  parseBatchSize(val: string) {
    return val;
  }

  @Option({
    flags: '--checks <list>',
    description: 'Comma-separated check categories',
  })
  parseChecks(val: string) {
    return val;
  }

  @Option({
    flags: '--extra <instructions>',
    description: 'Extra review instructions',
  })
  parseExtra(val: string) {
    return val;
  }

  @Option({
    flags: '--config <path>',
    description: 'Config file path',
  })
  parseConfig(val: string) {
    return val;
  }
}
