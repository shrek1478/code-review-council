import { Injectable, Logger, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CodeReaderService, CodebaseOptions } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { DecisionMakerService } from './decision-maker.service.js';
import { AcpService } from '../acp/acp.service.js';
import { IndividualReview, ReviewResult } from './review.types.js';

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    @Inject(CodeReaderService) private readonly codeReader: CodeReaderService,
    @Inject(CouncilService) private readonly council: CouncilService,
    @Inject(DecisionMakerService) private readonly decisionMaker: DecisionMakerService,
    @Inject(AcpService) private readonly acpService: AcpService,
  ) {}

  async reviewDiff(
    repoPath: string,
    baseBranch: string = 'main',
    checks: string[] = [],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    this.logger.log(`Starting diff review ${id}`);

    try {
      const code = await this.codeReader.readGitDiff(repoPath, baseBranch);
      return await this.runReview(id, code, checks, extraInstructions);
    } finally {
      await this.acpService.stopAll();
    }
  }

  async reviewFiles(
    filePaths: string[],
    checks: string[] = [],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    this.logger.log(`Starting file review ${id}`);

    try {
      const files = await this.codeReader.readFiles(filePaths);
      const code = files.map((f) => `=== ${f.path} ===\n${f.content}`).join('\n\n');
      return await this.runReview(id, code, checks, extraInstructions);
    } finally {
      await this.acpService.stopAll();
    }
  }

  async reviewCodebase(
    directory: string,
    options: CodebaseOptions = {},
    checks: string[] = [],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    this.logger.log(`Starting codebase review ${id}`);

    try {
      const batches = await this.codeReader.readCodebase(directory, options);
      this.logger.log(`Codebase split into ${batches.length} batch(es)`);

      if (batches.length === 1) {
        const code = batches[0]
          .map((f) => `=== ${f.path} ===\n${f.content}`)
          .join('\n\n');
        return await this.runReview(id, code, checks, extraInstructions);
      }

      const allReviews: IndividualReview[] = [];
      const allCode: string[] = [];
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const code = batch
          .map((f) => `=== ${f.path} ===\n${f.content}`)
          .join('\n\n');
        allCode.push(code);

        const batchExtra = [
          `[Batch ${i + 1}/${batches.length}]`,
          extraInstructions,
        ]
          .filter(Boolean)
          .join(' ');

        console.log(`\n=== Individual Reviews (Batch ${i + 1}/${batches.length}) ===\n`);
        const reviews = await this.council.dispatchReviews({
          code,
          checks,
          extraInstructions: batchExtra,
        });
        allReviews.push(...reviews);
      }

      const fullCode = allCode.join('\n\n');
      const decision = await this.decisionMaker.decide(fullCode, allReviews);
      this.printDecision(decision);
      return { id, status: 'completed', individualReviews: allReviews, decision };
    } finally {
      await this.acpService.stopAll();
    }
  }

  private async runReview(
    id: string,
    code: string,
    checks: string[],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    console.log('\n=== Individual Reviews ===\n');
    const individualReviews = await this.council.dispatchReviews({
      code,
      checks,
      extraInstructions,
    });

    const decision = await this.decisionMaker.decide(code, individualReviews);
    this.printDecision(decision);

    return {
      id,
      status: 'completed',
      individualReviews,
      decision,
    };
  }

  private printDecision(decision: any): void {
    console.log('\n=== Final Decision (by ' + decision.reviewer + ') ===\n');
    console.log(decision.overallAssessment);
    if (decision.decisions?.length > 0) {
      console.log('\nDecisions:');
      for (const d of decision.decisions) {
        const verdict = d.verdict === 'accepted' ? '\u2705' : d.verdict === 'rejected' ? '\u274C' : '\u270F\uFE0F';
        console.log(`  ${verdict} [${d.severity}] ${d.category}: ${d.description}`);
        if (d.reasoning) console.log(`    Reasoning: ${d.reasoning}`);
        if (d.suggestion) console.log(`    Action: ${d.suggestion}`);
        if (d.raisedBy?.length > 0) console.log(`    Raised by: ${d.raisedBy.join(', ')}`);
      }
    }
    if (decision.additionalFindings?.length > 0) {
      console.log('\nAdditional Findings (by Decision Maker):');
      for (const f of decision.additionalFindings) {
        console.log(`  [${f.severity}] ${f.category}: ${f.description}`);
        if (f.suggestion) console.log(`    Action: ${f.suggestion}`);
      }
    }
  }
}
