import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject } from '@nestjs/common';
import { ReviewService } from '../review/review.service.js';
import { ConfigService } from '../config/config.service.js';
import { printResult } from './result-printer.js';

@Command({ name: 'file', description: 'Review specific files' })
export class FileCommand extends CommandRunner {
  constructor(
    @Inject(ReviewService) private readonly reviewService: ReviewService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(params: string[], options: Record<string, string>): Promise<void> {
    if (params.length === 0) {
      throw new Error('Please provide at least one file path.');
    }

    await this.configService.loadConfig(options.config);

    const checks = options.checks?.split(',').filter(Boolean) ?? [];
    const extra = options.extra;

    console.log('\n=== Code Review Council ===\n');
    console.log(`Files: ${params.join(', ')}`);
    console.log('Reviewing...\n');

    const result = await this.reviewService.reviewFiles(
      params,
      checks,
      extra,
    );

    printResult(result);
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
