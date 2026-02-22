import { Injectable, ConsoleLogger, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolve, relative } from 'node:path';
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
import { CouncilConfig } from '../config/config.types.js';
import { IndividualReview, ReviewResult } from './review.types.js';
import { sanitizeErrorMessage } from './retry-utils.js';
import { isWithinRoot } from './path-utils.js';
import { BATCH_CONCURRENCY } from '../constants.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x09\x0B\x0C\x0E-\x1F\x7F]/g;
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

  private resolveMode(modeOverride?: 'inline' | 'batch' | 'explore', config?: CouncilConfig): 'inline' | 'batch' | 'explore' {
    return modeOverride ?? (config ?? this.configService.getConfig()).review.mode ?? 'batch';
  }

  async reviewDiff(
    repoPath: string,
    baseBranch: string = 'main',
    checks: string[] = [],
    extraInstructions?: string,
    onDelta?: (reviewer: string, delta: string) => void,
    onReviewerDone?: (reviewer: string, status: 'done' | 'error', durationMs: number, error?: string) => void,
    onToolActivity?: (reviewer: string, toolName: string, args?: unknown) => void,
    modeOverride?: 'inline' | 'batch' | 'explore',
    configOverride?: CouncilConfig,
    onDmDelta?: (content: string) => void,
    onDmStart?: (dmName: string) => void,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    const startMs = Date.now();
    this.logger.log(`Starting diff review ${id} (mode: ${modeOverride ?? 'config'})`);

    // Always send diff content inline, even in explore mode.
    // Unlike reviewFiles/reviewCodebase (which send only file paths in explore mode
    // and let the agent read files itself), diff content must be provided because
    // the agent cannot reproduce `git diff` on its own.
    const code = await this.codeReader.readGitDiff(repoPath, baseBranch);

    let result: ReviewResult;
    const mode = this.resolveMode(modeOverride, configOverride);
    if (mode === 'explore') {
      let absolutePath: string;
      try {
        absolutePath = await realpath(resolve(repoPath));
      } catch {
        absolutePath = resolve(repoPath);
      }
      result = await this.runReview(
        id, code, checks, extraInstructions, absolutePath,
        onDelta, onReviewerDone, onToolActivity, configOverride, onDmDelta, onDmStart,
      );
    } else {
      result = await this.runReview(id, code, checks, extraInstructions, undefined, onDelta, onReviewerDone, onToolActivity, configOverride, onDmDelta, onDmStart);
    }
    result.durationMs = Date.now() - startMs;
    this.logger.log(`Diff review ${id} completed in ${result.durationMs}ms`);
    return result;
  }

  async reviewFiles(
    filePaths: string[],
    checks: string[] = [],
    extraInstructions?: string,
    onDelta?: (reviewer: string, delta: string) => void,
    onReviewerDone?: (reviewer: string, status: 'done' | 'error', durationMs: number, error?: string) => void,
    onToolActivity?: (reviewer: string, toolName: string, args?: unknown) => void,
    modeOverride?: 'inline' | 'batch' | 'explore',
    configOverride?: CouncilConfig,
    onDmDelta?: (content: string) => void,
    onDmStart?: (dmName: string) => void,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    const startMs = Date.now();
    this.logger.log(`Starting file review ${id} (mode: ${modeOverride ?? 'config'})`);

    let result: ReviewResult;
    const mode = this.resolveMode(modeOverride, configOverride);
    if (mode === 'explore') {
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
              if (!isWithinRoot(real, repoRoot)) {
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
        id, safePaths, checks, extraInstructions, repoRoot,
        onDelta, onReviewerDone, onToolActivity, configOverride, onDmDelta, onDmStart,
      );
    } else {
      const files = await this.codeReader.readFiles(filePaths);
      if (mode === 'inline') {
        const code = files
          .map((f) => `=== ${sanitizeFileName(f.path)} ===\n${f.content}`)
          .join('\n\n');
        this.logger.log(`Inline mode: ${files.length} files, ${code.length} chars`);
        result = await this.runReview(id, code, checks, extraInstructions, undefined, onDelta, onReviewerDone, onToolActivity, configOverride, onDmDelta, onDmStart);
      } else {
        const batches = this.codeReader.createBatches(files);
        this.logger.log(`Batch mode: ${files.length} files split into ${batches.length} batch(es)`);
        result = await this.runBatchedInlineReview(
          id, batches, checks, extraInstructions,
          onDelta, onReviewerDone, onToolActivity, configOverride, onDmDelta, onDmStart,
        );
      }
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
    onDelta?: (reviewer: string, delta: string) => void,
    onReviewerDone?: (reviewer: string, status: 'done' | 'error', durationMs: number, error?: string) => void,
    onToolActivity?: (reviewer: string, toolName: string, args?: unknown) => void,
    modeOverride?: 'inline' | 'batch' | 'explore',
    configOverride?: CouncilConfig,
    onDmDelta?: (content: string) => void,
    onDmStart?: (dmName: string) => void,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    const startMs = Date.now();
    this.logger.log(`Starting codebase review ${id} (mode: ${modeOverride ?? 'config'})`);

    let result: ReviewResult;
    const mode = this.resolveMode(modeOverride, configOverride);

    if (mode === 'explore') {
      let absoluteDir: string;
      try {
        absoluteDir = await realpath(resolve(directory));
      } catch {
        absoluteDir = resolve(directory);
      }
      const filePaths = await this.codeReader.listCodebaseFiles(absoluteDir, options);
      this.logger.log(`Exploration mode: found ${filePaths.length} files (no content)`);
      result = await this.runExplorationReview(
        id, filePaths, checks, extraInstructions, absoluteDir,
        onDelta, onReviewerDone, onToolActivity, configOverride, onDmDelta, onDmStart,
      );
    } else if (mode === 'inline') {
      const batches = await this.codeReader.readCodebase(directory, options);
      const allFiles = batches.flat();
      const code = allFiles
        .map((f) => `=== ${sanitizeFileName(f.path)} ===\n${f.content}`)
        .join('\n\n');
      this.logger.log(`Inline mode: ${allFiles.length} files, ${code.length} chars`);
      result = await this.runReview(id, code, checks, extraInstructions, undefined, onDelta, onReviewerDone, onToolActivity, configOverride, onDmDelta, onDmStart);
    } else {
      const batches = await this.codeReader.readCodebase(directory, options);
      this.logger.log(`Batch mode: split into ${batches.length} batch(es)`);
      result = await this.runBatchedInlineReview(
        id, batches, checks, extraInstructions,
        onDelta, onReviewerDone, onToolActivity, configOverride, onDmDelta, onDmStart,
      );
    }

    result.durationMs = Date.now() - startMs;
    this.logger.log(
      `Codebase review ${id} completed in ${result.durationMs}ms`,
    );
    return result;
  }

  private groupReviewsByReviewer(reviews: IndividualReview[]): Map<string, IndividualReview[]> {
    const grouped = new Map<string, IndividualReview[]>();
    for (const r of reviews) {
      const list = grouped.get(r.reviewer) ?? [];
      list.push(r);
      grouped.set(r.reviewer, list);
    }
    return grouped;
  }

  private mergeReviewsByReviewer(reviews: IndividualReview[]): IndividualReview[] {
    return [...this.groupReviewsByReviewer(reviews).entries()].map(([reviewer, batchReviews]) => {
      const hasError = batchReviews.some((r) => r.status === 'error');
      const combined =
        batchReviews.length === 1
          ? batchReviews[0].review
          : batchReviews
              .map((r, i) => `## Batch ${i + 1}\n\n${r.review}`)
              .join('\n\n---\n\n');
      return {
        reviewer,
        review: combined,
        status: hasError ? ('error' as const) : ('success' as const),
        durationMs: batchReviews.reduce((sum, r) => sum + (r.durationMs ?? 0), 0),
      };
    });
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
    onDelta?: (reviewer: string, delta: string) => void,
    onReviewerDone?: (reviewer: string, status: 'done' | 'error', durationMs: number, error?: string) => void,
    onToolActivity?: (reviewer: string, toolName: string, args?: unknown) => void,
    configOverride?: CouncilConfig,
    onDmDelta?: (content: string) => void,
    onDmStart?: (dmName: string) => void,
  ): Promise<ReviewResult> {
    const individualReviews = await this.council.dispatchReviews({
      checks,
      extraInstructions,
      repoPath,
      filePaths,
    }, onDelta, onReviewerDone, onToolActivity, configOverride);

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
        repoPath,
        configOverride,
        onDmDelta,
        onDmStart,
      );
      const status =
        decision.parseFailed || this.hasAnyReviewerFailure(individualReviews)
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
    onDelta?: (reviewer: string, delta: string) => void,
    onReviewerDone?: (reviewer: string, status: 'done' | 'error', durationMs: number, error?: string) => void,
    onToolActivity?: (reviewer: string, toolName: string, args?: unknown) => void,
    configOverride?: CouncilConfig,
    onDmDelta?: (content: string) => void,
    onDmStart?: (dmName: string) => void,
  ): Promise<ReviewResult> {
    if (batches.length === 1) {
      const code = batches[0]
        .map((f) => `=== ${sanitizeFileName(f.path)} ===\n${f.content}`)
        .join('\n\n');
      return this.runReview(id, code, checks, extraInstructions, undefined, onDelta, onReviewerDone, onToolActivity, configOverride);
    }

    // Multi-batch: review batches with limited concurrency, then pass file summary to decision maker
    const allReviews: IndividualReview[] = [];
    const allFileNames: string[] = [];

    // Reviewer names for synthetic progress notifications
    const reviewerNames = (configOverride ?? this.configService.getConfig()).reviewers.map((r) => r.name);

    // Collect file names upfront
    for (const batch of batches) {
      for (const f of batch) {
        const lineCount = f.content.split('\n').length;
        allFileNames.push(`${sanitizeFileName(f.path)} (${lineCount} lines)`);
      }
    }

    for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
      const chunk = batches.slice(i, i + BATCH_CONCURRENCY);
      // Notify UI once per chunk (before parallel dispatch) to avoid rapid-fire overwrites
      const chunkStart = i + 1;
      const chunkEnd = Math.min(i + BATCH_CONCURRENCY, batches.length);
      const batchLabel = chunkStart === chunkEnd
        ? `Batch ${chunkStart} / ${batches.length}`
        : `Batches ${chunkStart}–${chunkEnd} / ${batches.length}`;
      const chunkFiles = chunk.reduce((sum, b) => sum + b.length, 0);
      for (const name of reviewerNames) {
        onToolActivity?.(name, batchLabel, { files: chunkFiles });
      }
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
          // Batch phase: run silently — no delta or progress events.
          // onDelta/onReviewerDone are deferred until synthesis completes.
          const reviews = await this.council.dispatchReviews({
            code,
            checks,
            extraInstructions: batchExtra,
          }, undefined, undefined, onToolActivity, configOverride);
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
      return { id, status: 'failed', individualReviews: this.mergeReviewsByReviewer(allReviews) };
    }

    // Each reviewer consolidates their own batch findings before passing to DM
    const config = configOverride ?? this.configService.getConfig();
    const lang = config.review.language ?? 'zh-tw';
    const grouped = this.groupReviewsByReviewer(allReviews);
    const synthesizedReviews = await Promise.all(
      [...grouped.entries()].map(async ([reviewerName, batchReviews]) => {
        const reviewerConfig = config.reviewers.find((r) => r.name === reviewerName);
        if (!reviewerConfig || batchReviews.length <= 1) {
          const result = batchReviews.length === 1 ? batchReviews[0] : this.mergeReviewsByReviewer(batchReviews)[0];
          onReviewerDone?.(reviewerName, result.status === 'error' ? 'error' : 'done', result.durationMs ?? 0);
          return result;
        }
        this.logger.log(`[Synthesis] ${reviewerName}: consolidating ${batchReviews.length} batch reviews...`);
        // Notify UI: batch phase done, synthesis starting
        onToolActivity?.(reviewerName, 'Merging...', undefined);
        // Synthesis: stream delta content to frontend, then fire a single reviewerDone
        const result = await this.council.synthesizeReview(reviewerConfig, batchReviews, lang, undefined, onDelta, onToolActivity);
        onReviewerDone?.(reviewerName, result.status === 'error' ? 'error' : 'done', result.durationMs ?? 0);
        return result;
      }),
    );
    this.logger.log(`Synthesis complete. Sending ${synthesizedReviews.length} reviews to decision maker...`);
    const fileSummary = allFileNames.join('\n');
    try {
      const decision = await this.decisionMaker.decide(
        fileSummary,
        synthesizedReviews,
        'batch',
        undefined,
        configOverride,
        onDmDelta,
        onDmStart,
      );
      const status =
        decision.parseFailed || this.hasAnyReviewerFailure(synthesizedReviews)
          ? 'partial'
          : 'completed';
      return {
        id,
        status,
        individualReviews: synthesizedReviews,
        decision,
      };
    } catch (error) {
      this.logger.error(
        `Decision maker failed, returning partial result: ${sanitizeErrorMessage(error)}`,
      );
      return { id, status: 'partial', individualReviews: synthesizedReviews };
    }
  }

  private async resolveGitRoot(): Promise<string> {
    try {
      const toplevel = await simpleGit().revparse(['--show-toplevel']);
      return await realpath(toplevel.trim());
    } catch {
      throw new Error(
        'Not inside a git repository. Explore mode requires a git repo for file listing and path validation.',
      );
    }
  }

  private async runReview(
    id: string,
    code: string,
    checks: string[],
    extraInstructions?: string,
    repoPath?: string,
    onDelta?: (reviewer: string, delta: string) => void,
    onReviewerDone?: (reviewer: string, status: 'done' | 'error', durationMs: number, error?: string) => void,
    onToolActivity?: (reviewer: string, toolName: string, args?: unknown) => void,
    configOverride?: CouncilConfig,
    onDmDelta?: (content: string) => void,
    onDmStart?: (dmName: string) => void,
  ): Promise<ReviewResult> {
    const individualReviews = await this.council.dispatchReviews({
      code,
      checks,
      extraInstructions,
      repoPath,
    }, onDelta, onReviewerDone, onToolActivity, configOverride);

    // All reviewers failed → no usable data for the decision maker, return 'failed'.
    // If only some reviewers failed, proceed to the DM — partial data is still valuable.
    if (this.allReviewsFailed(individualReviews)) {
      this.logger.error('All reviewers failed, skipping decision maker');
      return { id, status: 'failed', individualReviews };
    }

    try {
      const decision = await this.decisionMaker.decide(code, individualReviews, 'inline', repoPath, configOverride, onDmDelta, onDmStart);
      const status =
        decision.parseFailed || this.hasAnyReviewerFailure(individualReviews)
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
