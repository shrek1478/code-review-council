import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject } from '@nestjs/common';
import { ReviewService } from '../review/review.service.js';
import { ConfigService } from '../config/config.service.js';
import { ReviewResult } from '../review/review.types.js';

@Command({ name: 'file', description: 'Review specific files' })
export class FileCommand extends CommandRunner {
  constructor(
    @Inject(ReviewService) private readonly reviewService: ReviewService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(params: string[], options: Record<string, any>): Promise<void> {
    if (params.length === 0) {
      throw new Error('Please provide at least one file path.');
    }

    await this.configService.loadConfig(options.config);

    const checks = options.checks?.split(',').filter(Boolean) ?? [];
    const extra = options.extra;

    console.log('\n=== Code Review Council ===\n');
    console.log(`Files: ${params.join(', ')}`);
    console.log('Reviewing...\n');

    const result = await this.reviewService.reviewFiles(params, checks, extra);

    this.printResult(result);
  }

  private printResult(result: ReviewResult): void {
    console.log('\n=== Individual Reviews ===\n');
    for (const r of result.individualReviews) {
      console.log(`\n--- ${r.reviewer} ---`);
      console.log(r.review);
      console.log();
    }

    if (result.decision) {
      console.log('\n=== Final Decision (by ' + result.decision.reviewer + ') ===\n');
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

  @Option({ flags: '--checks <list>', description: 'Comma-separated check categories' })
  parseChecks(val: string) { return val; }

  @Option({ flags: '--extra <instructions>', description: 'Extra review instructions' })
  parseExtra(val: string) { return val; }

  @Option({ flags: '--config <path>', description: 'Config file path' })
  parseConfig(val: string) { return val; }
}
