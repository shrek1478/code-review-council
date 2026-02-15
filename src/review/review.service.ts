import { Injectable, ConsoleLogger, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CodeReaderService, CodebaseOptions } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { DecisionMakerService } from './decision-maker.service.js';
import { AcpService } from '../acp/acp.service.js';
import { IndividualReview, ReviewResult } from './review.types.js';

@Injectable()
export class ReviewService {
  constructor(
    @Inject(ConsoleLogger) private readonly logger: ConsoleLogger,
    @Inject(CodeReaderService) private readonly codeReader: CodeReaderService,
    @Inject(CouncilService) private readonly council: CouncilService,
    @Inject(DecisionMakerService) private readonly decisionMaker: DecisionMakerService,
    @Inject(AcpService) private readonly acpService: AcpService,
  ) {
    this.logger.setContext(ReviewService.name);
  }

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

      // Multi-batch: review each batch, then pass file summary (not full code) to decision maker
      const allReviews: IndividualReview[] = [];
      const allFileNames: string[] = [];
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const code = batch
          .map((f) => `=== ${f.path} ===\n${f.content}`)
          .join('\n\n');

        for (const f of batch) {
          const lineCount = f.content.split('\n').length;
          allFileNames.push(`${f.path} (${lineCount} lines)`);
        }

        const batchExtra = [
          `[Batch ${i + 1}/${batches.length}]`,
          extraInstructions,
        ]
          .filter(Boolean)
          .join(' ');

        const reviews = await this.council.dispatchReviews({
          code,
          checks,
          extraInstructions: batchExtra,
        });
        allReviews.push(...reviews);

        // Release clients after each batch (A1)
        await this.acpService.stopAll();
      }

      // Pass file summary instead of full code to decision maker (A2)
      const fileSummary = allFileNames.join('\n');
      const decision = await this.decisionMaker.decide(fileSummary, allReviews, true);
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
    const individualReviews = await this.council.dispatchReviews({
      code,
      checks,
      extraInstructions,
    });

    const decision = await this.decisionMaker.decide(code, individualReviews);

    return {
      id,
      status: 'completed',
      individualReviews,
      decision,
    };
  }
}
