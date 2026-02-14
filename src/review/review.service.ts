import { Injectable, Logger, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CodeReaderService, CodebaseOptions } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { SummarizerService } from './summarizer.service.js';
import { AcpService } from '../acp/acp.service.js';
import { IndividualReview, ReviewResult } from './review.types.js';

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    @Inject(CodeReaderService) private readonly codeReader: CodeReaderService,
    @Inject(CouncilService) private readonly council: CouncilService,
    @Inject(SummarizerService) private readonly summarizer: SummarizerService,
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
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const code = batch
          .map((f) => `=== ${f.path} ===\n${f.content}`)
          .join('\n\n');

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
      }

      const summary = await this.summarizer.summarize(allReviews);
      return { id, status: 'completed', individualReviews: allReviews, summary };
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

    const summary = await this.summarizer.summarize(individualReviews);

    return {
      id,
      status: 'completed',
      individualReviews,
      summary,
    };
  }
}
