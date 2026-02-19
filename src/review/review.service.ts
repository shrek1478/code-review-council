import { Injectable, ConsoleLogger, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import { realpath } from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import {
  CodeReaderService,
  CodebaseOptions,
  FileContent,
} from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { DecisionMakerService } from './decision-maker.service.js';
import { ConfigService } from '../config/config.service.js';
import { IndividualReview, ReviewResult } from './review.types.js';
import { sanitizeErrorMessage } from './retry-utils.js';
import { BATCH_CONCURRENCY } from '../constants.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
function sanitizeFileName(name: string): string {
  return name.replace(CONTROL_CHARS, '').replace(/[\r\n]+/g, ' ');
}

@Injectable()
export class ReviewService {
  constructor(
    @Inject(ConsoleLogger) private readonly logger: ConsoleLogger,
    @Inject(CodeReaderService) private readonly codeReader: CodeReaderService,
    @Inject(CouncilService) private readonly council: CouncilService,
    @Inject(DecisionMakerService)
    private readonly decisionMaker: DecisionMakerService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.logger.setContext(ReviewService.name);
  }

  private get allowExplore(): boolean {
    return this.configService.getConfig().review.mode === 'explore';
  }

  async reviewDiff(
    repoPath: string,
    baseBranch: string = 'main',
    checks: string[] = [],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    const startMs = Date.now();
    this.logger.log(`Starting diff review ${id}`);

    // Always send diff — agent cannot reproduce git diff on its own
    const code = await this.codeReader.readGitDiff(repoPath, baseBranch);

    let result: ReviewResult;
    if (this.allowExplore) {
      let absolutePath: string;
      try {
        absolutePath = await realpath(resolve(repoPath));
      } catch {
        absolutePath = resolve(repoPath);
      }
      result = await this.runReview(
        id,
        code,
        checks,
        extraInstructions,
        absolutePath,
      );
    } else {
      result = await this.runReview(id, code, checks, extraInstructions);
    }
    result.durationMs = Date.now() - startMs;
    this.logger.log(`Diff review ${id} completed in ${result.durationMs}ms`);
    return result;
  }

  async reviewFiles(
    filePaths: string[],
    checks: string[] = [],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    const startMs = Date.now();
    this.logger.log(`Starting file review ${id}`);

    let result: ReviewResult;
    if (this.allowExplore) {
      // Exploration mode: only send file paths, agent reads content itself
      const repoRoot = await this.resolveGitRoot();
      const safePaths: string[] = [];
      const REALPATH_CHUNK = 20;
      for (let i = 0; i < filePaths.length; i += REALPATH_CHUNK) {
        const chunk = filePaths.slice(i, i + REALPATH_CHUNK);
        const results = await Promise.all(
          chunk.map(async (p) => {
            const abs = resolve(p);
            try {
              const real = await realpath(abs);
              const rel = relative(repoRoot, real);
              if (rel.startsWith('..') || isAbsolute(rel)) {
                this.logger.warn(`Skipping file outside repo root: ${p}`);
                return null;
              }
              if (this.codeReader.isSensitiveFile(real)) {
                this.logger.warn(`Skipping sensitive file: ${p}`);
                return null;
              }
              return relative(repoRoot, real);
            } catch {
              this.logger.warn(`Skipping unresolvable path: ${p}`);
              return null;
            }
          }),
        );
        for (const r of results) {
          if (r !== null) safePaths.push(r);
        }
      }
      if (safePaths.length === 0) {
        throw new Error('No valid files to review after path validation');
      }
      this.logger.log(
        `Exploration mode: sending ${safePaths.length} file paths (no content)`,
      );
      result = await this.runExplorationReview(
        id,
        safePaths,
        checks,
        extraInstructions,
        repoRoot,
      );
    } else {
      const files = await this.codeReader.readFiles(filePaths);
      const batches = this.codeReader.createBatches(files);
      this.logger.log(`File review split into ${batches.length} batch(es)`);
      result = await this.runBatchedInlineReview(
        id,
        batches,
        checks,
        extraInstructions,
      );
    }
    result.durationMs = Date.now() - startMs;
    this.logger.log(`File review ${id} completed in ${result.durationMs}ms`);
    return result;
  }

  async reviewCodebase(
    directory: string,
    options: CodebaseOptions = {},
    checks: string[] = [],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    const startMs = Date.now();
    this.logger.log(`Starting codebase review ${id}`);

    let result: ReviewResult;

    if (this.allowExplore) {
      // Exploration mode: only list files, no content reading, no batching
      let absoluteDir: string;
      try {
        absoluteDir = await realpath(resolve(directory));
      } catch {
        absoluteDir = resolve(directory);
      }
      const filePaths = await this.codeReader.listCodebaseFiles(
        absoluteDir,
        options,
      );
      this.logger.log(
        `Exploration mode: found ${filePaths.length} files (no content)`,
      );
      result = await this.runExplorationReview(
        id,
        filePaths,
        checks,
        extraInstructions,
        absoluteDir,
      );
    } else {
      const batches = await this.codeReader.readCodebase(directory, options);
      this.logger.log(`Codebase split into ${batches.length} batch(es)`);
      result = await this.runBatchedInlineReview(
        id,
        batches,
        checks,
        extraInstructions,
      );
    }

    result.durationMs = Date.now() - startMs;
    this.logger.log(
      `Codebase review ${id} completed in ${result.durationMs}ms`,
    );
    return result;
  }

  private allReviewsFailed(reviews: IndividualReview[]): boolean {
    return reviews.length > 0 && reviews.every((r) => r.status === 'error');
  }

  private hasAnyReviewerFailure(reviews: IndividualReview[]): boolean {
    return reviews.some((r) => r.status === 'error');
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

    if (this.allReviewsFailed(individualReviews)) {
      this.logger.error('All reviewers failed, skipping decision maker');
      return { id, status: 'failed', individualReviews };
    }

    const fileSummary = filePaths.map(sanitizeFileName).join('\n');
    try {
      const decision = await this.decisionMaker.decide(
        fileSummary,
        individualReviews,
        'explore',
      );
      const status = this.hasAnyReviewerFailure(individualReviews)
        ? 'partial'
        : 'completed';
      return { id, status, individualReviews, decision };
    } catch (error) {
      this.logger.error(
        `Decision maker failed, returning partial result: ${sanitizeErrorMessage(error)}`,
      );
      return { id, status: 'partial', individualReviews };
    }
  }

  private async runBatchedInlineReview(
    id: string,
    batches: FileContent[][],
    checks: string[],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    if (batches.length === 1) {
      const code = batches[0]
        .map((f) => `=== ${sanitizeFileName(f.path)} ===\n${f.content}`)
        .join('\n\n');
      return this.runReview(id, code, checks, extraInstructions);
    }

    // Multi-batch: review batches with limited concurrency, then pass file summary to decision maker
    const allReviews: IndividualReview[] = [];
    const allFileNames: string[] = [];

    // Collect file names upfront
    for (const batch of batches) {
      for (const f of batch) {
        const lineCount = f.content.split('\n').length;
        allFileNames.push(`${sanitizeFileName(f.path)} (${lineCount} lines)`);
      }
    }

    for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
      const chunk = batches.slice(i, i + BATCH_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (batch, j) => {
          const batchIdx = i + j;
          const code = batch
            .map((f) => `=== ${sanitizeFileName(f.path)} ===\n${f.content}`)
            .join('\n\n');
          const batchExtra = [
            `[Batch ${batchIdx + 1}/${batches.length}]`,
            extraInstructions,
          ]
            .filter(Boolean)
            .join(' ');
          this.logger.log(
            `[Batch ${batchIdx + 1}/${batches.length}] Dispatching to reviewers (${batch.length} files, ${code.length} chars)...`,
          );
          const reviews = await this.council.dispatchReviews({
            code,
            checks,
            extraInstructions: batchExtra,
          });
          this.logger.log(
            `[Batch ${batchIdx + 1}/${batches.length}] Complete.`,
          );
          return reviews;
        }),
      );
      for (const reviews of chunkResults) {
        allReviews.push(...reviews);
      }
    }

    this.logger.log(
      `All ${batches.length} batches complete. ${allReviews.length} reviews collected.`,
    );

    if (this.allReviewsFailed(allReviews)) {
      this.logger.error('All reviewers failed, skipping decision maker');
      return { id, status: 'failed', individualReviews: allReviews };
    }

    this.logger.log(
      `Sending ${allReviews.length} reviews to decision maker...`,
    );
    const fileSummary = allFileNames.join('\n');
    try {
      const decision = await this.decisionMaker.decide(
        fileSummary,
        allReviews,
        'batch',
      );
      const status = this.hasAnyReviewerFailure(allReviews)
        ? 'partial'
        : 'completed';
      return {
        id,
        status,
        individualReviews: allReviews,
        decision,
      };
    } catch (error) {
      this.logger.error(
        `Decision maker failed, returning partial result: ${sanitizeErrorMessage(error)}`,
      );
      return { id, status: 'partial', individualReviews: allReviews };
    }
  }

  private async resolveGitRoot(): Promise<string> {
    try {
      const toplevel = await simpleGit().revparse(['--show-toplevel']);
      return await realpath(toplevel.trim());
    } catch {
      this.logger.warn(
        'Not inside a git repository, falling back to current working directory. ' +
          'Path validation in explore mode will use cwd as the root boundary.',
      );
      return await realpath(resolve('.'));
    }
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

    if (this.allReviewsFailed(individualReviews)) {
      this.logger.error('All reviewers failed, skipping decision maker');
      return { id, status: 'failed', individualReviews };
    }

    try {
      const decision = await this.decisionMaker.decide(code, individualReviews);
      const status = this.hasAnyReviewerFailure(individualReviews)
        ? 'partial'
        : 'completed';
      return {
        id,
        status,
        individualReviews,
        decision,
      };
    } catch (error) {
      this.logger.error(
        `Decision maker failed, returning partial result: ${sanitizeErrorMessage(error)}`,
      );
      return { id, status: 'partial', individualReviews };
    }
  }
}
