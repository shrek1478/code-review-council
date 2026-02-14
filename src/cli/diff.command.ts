import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject } from '@nestjs/common';
import { ReviewService } from '../review/review.service.js';
import { ConfigService } from '../config/config.service.js';

@Command({ name: 'diff', description: 'Review git diff' })
export class DiffCommand extends CommandRunner {
  constructor(
    @Inject(ReviewService) private readonly reviewService: ReviewService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(params: string[], options: Record<string, any>): Promise<void> {
    await this.configService.loadConfig(options.config);

    const repoPath = options.repo ?? process.cwd();
    const baseBranch = options.base ?? 'main';
    const checks = options.checks?.split(',') ?? [];
    const extra = options.extra;

    console.log('\n=== Code Review Council ===\n');
    console.log(`Repo: ${repoPath}`);
    console.log(`Base: ${baseBranch}`);
    console.log('Reviewing...\n');

    const result = await this.reviewService.reviewDiff(repoPath, baseBranch, checks, extra);
    this.printResult(result);
  }

  @Option({ flags: '--repo <path>', description: 'Repository path' })
  parseRepo(val: string) { return val; }

  @Option({ flags: '--base <branch>', description: 'Base branch (default: main)' })
  parseBase(val: string) { return val; }

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
    if (result.decision) {
      console.log('=== Final Decision (by ' + result.decision.reviewer + ') ===\n');
      console.log(result.decision.overallAssessment);
      if (result.decision.decisions?.length > 0) {
        console.log('\nDecisions:');
        for (const d of result.decision.decisions) {
          const verdict = d.verdict === 'accepted' ? '\u2705' : d.verdict === 'rejected' ? '\u274C' : '\u270F\uFE0F';
          console.log(`  ${verdict} [${d.severity}] ${d.category}: ${d.description}`);
          if (d.reasoning) console.log(`    Reasoning: ${d.reasoning}`);
          if (d.suggestion) console.log(`    Action: ${d.suggestion}`);
          if (d.raisedBy?.length > 0) console.log(`    Raised by: ${d.raisedBy.join(', ')}`);
        }
      }
      if (result.decision.additionalFindings?.length > 0) {
        console.log('\nAdditional Findings (by Decision Maker):');
        for (const f of result.decision.additionalFindings) {
          console.log(`  [${f.severity}] ${f.category}: ${f.description}`);
          if (f.suggestion) console.log(`    Action: ${f.suggestion}`);
        }
      }
    }
  }
}
