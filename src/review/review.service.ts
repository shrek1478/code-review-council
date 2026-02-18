import { Injectable, ConsoleLogger, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import { realpath } from 'node:fs/promises';
import { simpleGit } from 'simple-git';
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
      result = await this.runReview(
        id,
        code,
        checks,
        extraInstructions,
        resolve(repoPath),
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
      for (const p of filePaths) {
        const abs = resolve(p);
        try {
          const real = await realpath(abs);
          const rel = relative(repoRoot, real);
          if (rel.startsWith('..') || isAbsolute(rel)) {
            this.logger.warn(`Skipping file outside repo root: ${p}`);
            continue;
          }
          if (this.codeReader.isSensitiveFile(real)) {
            this.logger.warn(`Skipping sensitive file: ${p}`);
            continue;
          }
          // Use relative paths based on resolved real path to avoid symlink aliases
          safePaths.push(relative(repoRoot, real));
        } catch {
          this.logger.warn(`Skipping unresolvable path: ${p}`);
          continue;
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
      const code = files
        .map((f) => `=== ${f.path} ===\n${f.content}`)
        .join('\n\n');
      result = await this.runReview(id, code, checks, extraInstructions);
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
      const absoluteDir = resolve(directory);
      const filePaths = await this.codeReader.listCodebaseFiles(
        directory,
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

      if (batches.length === 1) {
        const code = batches[0]
          .map((f) => `=== ${f.path} ===\n${f.content}`)
          .join('\n\n');
        result = await this.runReview(id, code, checks, extraInstructions);
      } else {
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

          this.logger.log(
            `[Batch ${i + 1}/${batches.length}] Dispatching to reviewers (${batch.length} files, ${code.length} chars)...`,
          );
          const reviews = await this.council.dispatchReviews({
            code,
            checks,
            extraInstructions: batchExtra,
          });
          allReviews.push(...reviews);
          this.logger.log(`[Batch ${i + 1}/${batches.length}] Complete.`);
        }

        // Pass file summary instead of full code to decision maker
        this.logger.log(
          `All ${batches.length} batches complete. Sending ${allReviews.length} reviews to decision maker...`,
        );
        const fileSummary = allFileNames.join('\n');
        const decision = await this.decisionMaker.decide(
          fileSummary,
          allReviews,
          'batch',
        );
        result = {
          id,
          status: 'completed',
          individualReviews: allReviews,
          decision,
        };
      }
    }

    result.durationMs = Date.now() - startMs;
    this.logger.log(
      `Codebase review ${id} completed in ${result.durationMs}ms`,
    );
    return result;
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
    const decision = await this.decisionMaker.decide(
      fileSummary,
      individualReviews,
      'explore',
    );
    return { id, status: 'completed', individualReviews, decision };
  }

  private async resolveGitRoot(): Promise<string> {
    try {
      const toplevel = await simpleGit().revparse(['--show-toplevel']);
      return await realpath(toplevel.trim());
    } catch {
      // Fallback to CWD if not in a git repo
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

    const decision = await this.decisionMaker.decide(code, individualReviews);

    return {
      id,
      status: 'completed',
      individualReviews,
      decision,
    };
  }
}
