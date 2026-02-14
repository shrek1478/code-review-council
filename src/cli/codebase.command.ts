import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject } from '@nestjs/common';
import { ReviewService } from '../review/review.service.js';
import { ConfigService } from '../config/config.service.js';

@Command({ name: 'codebase', description: 'Review entire codebase' })
export class CodebaseCommand extends CommandRunner {
  constructor(
    @Inject(ReviewService) private readonly reviewService: ReviewService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(_params: string[], options: Record<string, any>): Promise<void> {
    await this.configService.loadConfig(options.config);

    const directory = options.dir ?? process.cwd();
    const extensions = options.extensions?.split(',').map((e: string) => e.trim()) ?? undefined;
    const maxBatchSize = options.batchSize ? parseInt(options.batchSize, 10) : undefined;
    const checks = options.checks?.split(',') ?? [];
    const extra = options.extra;

    console.log('\n=== Code Review Council ===\n');
    console.log(`Directory: ${directory}`);
    if (extensions) console.log(`Extensions: ${extensions.join(', ')}`);
    if (maxBatchSize) console.log(`Batch size: ${maxBatchSize}`);
    console.log('Reviewing...\n');

    const result = await this.reviewService.reviewCodebase(
      directory,
      { extensions, maxBatchSize },
      checks,
      extra,
    );

    this.printResult(result);
  }

  @Option({ flags: '--dir <path>', description: 'Directory to review (default: cwd)' })
  parseDir(val: string) { return val; }

  @Option({ flags: '--extensions <list>', description: 'Comma-separated file extensions (e.g. ts,js,py)' })
  parseExtensions(val: string) { return val; }

  @Option({ flags: '--batch-size <chars>', description: 'Max characters per batch (default: 100000)' })
  parseBatchSize(val: string) { return val; }

  @Option({ flags: '--checks <list>', description: 'Comma-separated check categories' })
  parseChecks(val: string) { return val; }

  @Option({ flags: '--extra <instructions>', description: 'Extra review instructions' })
  parseExtra(val: string) { return val; }

  @Option({ flags: '--config <path>', description: 'Config file path' })
  parseConfig(val: string) { return val; }

  private printResult(result: any) {
    console.log('=== Individual Reviews ===\n');
    for (const review of result.individualReviews) {
      console.log(`--- ${review.reviewer} ---`);
      console.log(review.review);
      console.log();
    }
    if (result.summary) {
      console.log('=== Summary (by ' + result.summary.reviewer + ') ===\n');
      console.log(result.summary.aggregatedReview);
      if (result.summary.issues?.length > 0) {
        console.log('\nIssues:');
        for (const issue of result.summary.issues) {
          console.log(`  [${issue.severity}] ${issue.category}: ${issue.description}`);
          if (issue.suggestion) console.log(`    Fix: ${issue.suggestion}`);
          if (issue.agreedBy?.length > 0) console.log(`    Agreed by: ${issue.agreedBy.join(', ')}`);
        }
      }
    }
  }
}
