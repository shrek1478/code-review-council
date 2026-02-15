import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject } from '@nestjs/common';
import { ReviewService } from '../review/review.service.js';
import { ConfigService } from '../config/config.service.js';
import { printResult } from './result-printer.js';

@Command({ name: 'diff', description: 'Review git diff' })
export class DiffCommand extends CommandRunner {
  constructor(
    @Inject(ReviewService) private readonly reviewService: ReviewService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(params: string[], options: Record<string, string>): Promise<void> {
    await this.configService.loadConfig(options.config);

    const repoPath = options.repo ?? process.cwd();
    const baseBranch = options.base ?? 'main';
    const checks = options.checks?.split(',').filter(Boolean) ?? [];
    const extra = options.extra;

    console.log('\n=== Code Review Council ===\n');
    console.log(`Repo: ${repoPath}`);
    console.log(`Base: ${baseBranch}`);
    console.log('Reviewing...\n');

    const result = await this.reviewService.reviewDiff(
      repoPath,
      baseBranch,
      checks,
      extra,
    );

    printResult(result);
  }

  @Option({
    flags: '--repo <path>',
    description: 'Repository path',
  })
  parseRepo(val: string) {
    return val;
  }

  @Option({
    flags: '--base <branch>',
    description: 'Base branch (default: main)',
  })
  parseBase(val: string) {
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
