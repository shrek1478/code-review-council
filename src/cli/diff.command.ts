import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject } from '@nestjs/common';
import { ReviewService } from '../review/review.service.js';
import { ConfigService } from '../config/config.service.js';
import {
  ReviewResult,
  ReviewDecision,
  ReviewDecisionItem,
} from '../review/review.types.js';

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
      this.printDecision(result.decision);
    }
  }

  private getVerdictIcon(verdict: ReviewDecisionItem['verdict']): string {
    if (verdict === 'accepted') return '\u2705';
    if (verdict === 'rejected') return '\u274C';
    return '\u270F\uFE0F';
  }

  private printDecisionItem(d: ReviewDecisionItem): void {
    const icon = this.getVerdictIcon(d.verdict);
    console.log(`  ${icon} [${d.severity}] ${d.category}: ${d.description}`);
    if (d.reasoning) console.log(`    Reasoning: ${d.reasoning}`);
    if (d.suggestion) console.log(`    Action: ${d.suggestion}`);
    if (d.raisedBy?.length > 0) {
      console.log(`    Raised by: ${d.raisedBy.join(', ')}`);
    }
  }

  private printDecision(decision: ReviewDecision): void {
    console.log(`\n=== Final Decision (by ${decision.reviewer}) ===\n`);
    console.log(decision.overallAssessment);
    if (decision.decisions.length > 0) {
      console.log('\nDecisions:');
      for (const d of decision.decisions) {
        this.printDecisionItem(d);
      }
    }
    if (decision.additionalFindings.length > 0) {
      console.log('\nAdditional Findings (by Decision Maker):');
      for (const f of decision.additionalFindings) {
        console.log(`  [${f.severity}] ${f.category}: ${f.description}`);
        if (f.suggestion) console.log(`    Action: ${f.suggestion}`);
      }
    }
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
