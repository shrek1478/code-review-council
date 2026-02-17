import { Injectable, ConsoleLogger, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { CodeReaderService, CodebaseOptions } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { DecisionMakerService } from './decision-maker.service.js';
import { ConfigService } from '../config/config.service.js';
import { IndividualReview, ReviewResult } from './review.types.js';

@Injectable()
export class ReviewService {
  constructor(
    @Inject(ConsoleLogger) private readonly logger: ConsoleLogger,
    @Inject(CodeReaderService) private readonly codeReader: CodeReaderService,
    @Inject(CouncilService) private readonly council: CouncilService,
    @Inject(DecisionMakerService) private readonly decisionMaker: DecisionMakerService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.logger.setContext(ReviewService.name);
  }

  private get allowExplore(): boolean {
    return this.configService.getConfig().review.allowLocalExploration === true;
  }

  async reviewDiff(
    repoPath: string,
    baseBranch: string = 'main',
    checks: string[] = [],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    this.logger.log(`Starting diff review ${id}`);

    // Always send diff — agent cannot reproduce git diff on its own
    const code = await this.codeReader.readGitDiff(repoPath, baseBranch);

    if (this.allowExplore) {
      return await this.runReview(id, code, checks, extraInstructions, resolve(repoPath));
    }
    return await this.runReview(id, code, checks, extraInstructions);
  }

  async reviewFiles(
    filePaths: string[],
    checks: string[] = [],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    this.logger.log(`Starting file review ${id}`);

    if (this.allowExplore) {
      // Exploration mode: only send file paths, agent reads content itself
      const absolutePaths = filePaths.map((p) => resolve(p));
      this.logger.log(`Exploration mode: sending ${absolutePaths.length} file paths (no content)`);
      return await this.runExplorationReview(id, absolutePaths, checks, extraInstructions, resolve('.'));
    }

    const files = await this.codeReader.readFiles(filePaths);
    const code = files.map((f) => `=== ${f.path} ===\n${f.content}`).join('\n\n');
    return await this.runReview(id, code, checks, extraInstructions);
  }

  async reviewCodebase(
    directory: string,
    options: CodebaseOptions = {},
    checks: string[] = [],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    this.logger.log(`Starting codebase review ${id}`);

    if (this.allowExplore) {
      // Exploration mode: only list files, no content reading, no batching
      const absoluteDir = resolve(directory);
      const filePaths = await this.codeReader.listCodebaseFiles(directory, options);
      this.logger.log(`Exploration mode: found ${filePaths.length} files (no content)`);
      return await this.runExplorationReview(id, filePaths, checks, extraInstructions, absoluteDir);
    }

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

      this.logger.log(`[Batch ${i + 1}/${batches.length}] Dispatching to reviewers (${batch.length} files, ${code.length} chars)...`);
      const reviews = await this.council.dispatchReviews({
        code,
        checks,
        extraInstructions: batchExtra,
      });
      allReviews.push(...reviews);
      this.logger.log(`[Batch ${i + 1}/${batches.length}] Complete.`);
    }

    // Pass file summary instead of full code to decision maker
    this.logger.log(`All ${batches.length} batches complete. Sending ${allReviews.length} reviews to decision maker...`);
    const fileSummary = allFileNames.join('\n');
    const decision = await this.decisionMaker.decide(fileSummary, allReviews, true);
    return { id, status: 'completed', individualReviews: allReviews, decision };
  }

  private async runExplorationReview(
    id: string,
    filePaths: string[],
    checks: string[],
    extraInstructions?: string,
    repoPath?: string,
  ): Promise<ReviewResult> {
    const individualReviews = await this.council.dispatchReviews({
      checks,
      extraInstructions,
      repoPath,
      filePaths,
    });

    const fileSummary = filePaths.join('\n');
    const decision = await this.decisionMaker.decide(fileSummary, individualReviews, true);
    return { id, status: 'completed', individualReviews, decision };
  }

  private async runReview(
    id: string,
    code: string,
    checks: string[],
    extraInstructions?: string,
    repoPath?: string,
  ): Promise<ReviewResult> {
    const individualReviews = await this.council.dispatchReviews({
      code,
      checks,
      extraInstructions,
      repoPath,
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
