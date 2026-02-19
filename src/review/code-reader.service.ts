import { Injectable, ConsoleLogger, Inject, Optional } from '@nestjs/common';
import { simpleGit } from 'simple-git';
import { readFile, stat, realpath } from 'node:fs/promises';
import { join, extname, resolve, relative, isAbsolute } from 'node:path';
import { ConfigService } from '../config/config.service.js';

export interface FileContent {
  path: string;
  content: string;
}

export interface CodebaseOptions {
  extensions?: string[];
  maxBatchSize?: number;
}

export const DEFAULT_EXTENSIONS = [
  '.ts',
  '.js',
  '.tsx',
  '.jsx',
  '.py',
  '.go',
  '.java',
  '.kt',
  '.rs',
  '.rb',
  '.php',
  '.cs',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.vue',
  '.svelte',
  '.html',
  '.css',
  '.scss',
  '.json',
  '.yaml',
  '.yml',
];

const SENSITIVE_PATTERNS = [
  /^\.env($|\.)/i,
  /^\.envrc$/i,
  /^\.npmrc$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /^id_rsa/,
  /^id_ed25519/,
  /^id_ecdsa/,
  /(^|[^A-Z])[Ss][Ee][Cc][Rr][Ee][Tt]s?($|[^a-z])/,
  /(^|[^A-Z])[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]s?($|[^a-z])/,
  /\.keystore$/i,
];

/** Maximum single file size in bytes (measured via fs.stat). */
const MAX_FILE_SIZE = 1_048_576; // 1MB
/** Maximum cumulative size in bytes (measured via Buffer.byteLength for UTF-8 accuracy). */
const MAX_TOTAL_SIZE = 200 * 1_048_576; // 200MB cumulative limit
/** Maximum diff output size in characters (git diff returns text). */
const MAX_DIFF_SIZE = 5 * 1_048_576; // 5MB diff size limit
const BRANCH_PATTERN = /^[A-Za-z0-9._\-/]+$/;
const CONCURRENCY = 16;
/** When changed files exceed this threshold, avoid expanding file list in git diff args (ARG_MAX risk). */
const MAX_DIFF_FILE_ARGS = 100;

@Injectable()
export class CodeReaderService {
  constructor(
    @Inject(ConsoleLogger) private readonly logger: ConsoleLogger,
    @Optional()
    @Inject(ConfigService)
    private readonly configService?: ConfigService,
  ) {
    this.logger.setContext(CodeReaderService.name);
  }

  private cachedExtensions: string[] | undefined;
  private cachedSensitivePatterns: RegExp[] | undefined;

  private get extensions(): string[] {
    if (this.cachedExtensions) return this.cachedExtensions;
    let configured: string[] | undefined;
    let configLoaded = true;
    try {
      configured = this.configService?.getConfig()?.review?.extensions;
    } catch (error) {
      if (
        error instanceof Error && error.message.includes('Config not loaded')
      ) {
        configLoaded = false;
      } else {
        this.logger.warn(
          `Unexpected config error, using defaults: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    const result = (configured ?? DEFAULT_EXTENSIONS).map((e) =>
      e.startsWith('.') ? e : `.${e}`,
    );
    if (configLoaded) this.cachedExtensions = result;
    return result;
  }

  private get sensitivePatterns(): RegExp[] {
    if (this.cachedSensitivePatterns) return this.cachedSensitivePatterns;
    let configured: string[] | undefined;
    let configLoaded = true;
    try {
      configured = this.configService?.getConfig()?.review?.sensitivePatterns;
    } catch (error) {
      if (
        error instanceof Error && error.message.includes('Config not loaded')
      ) {
        configLoaded = false;
      } else {
        this.logger.warn(
          `Unexpected config error, using defaults: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    const result = configured
      ? [...SENSITIVE_PATTERNS, ...configured.map((p) => new RegExp(p))]
      : [...SENSITIVE_PATTERNS];
    if (configLoaded) this.cachedSensitivePatterns = result;
    return result;
  }

  async readGitDiff(
    repoPath: string,
    baseBranch: string = 'main',
  ): Promise<string> {
    if (
      !BRANCH_PATTERN.test(baseBranch) ||
      baseBranch.startsWith('-') ||
      baseBranch.includes('..')
    ) {
      throw new Error(`Invalid base branch name: "${baseBranch}"`);
    }
    this.logger.log(`Reading git diff: ${repoPath} (base: ${baseBranch})`);
    const git = simpleGit(repoPath);

    // Use merge-base for more accurate diff (only changes introduced on this branch)
    let mergeBase: string;
    try {
      const raw = await git.raw(['merge-base', baseBranch, 'HEAD']);
      mergeBase = raw.trim();
    } catch {
      // Fallback to baseBranch directly (e.g. shallow clone or no common ancestor)
      mergeBase = baseBranch;
    }

    // Get changed file list and filter out sensitive files
    const changedFiles = await this.getFilteredDiffFiles(git, [mergeBase]);
    if (changedFiles.length === 0) {
      // Try staged diff
      const stagedFiles = await this.getFilteredDiffFiles(git, ['--staged']);
      if (stagedFiles.length === 0) {
        throw new Error('No diff found');
      }
      return this.truncateDiff(
        await this.chunkedDiff(git, ['--staged'], stagedFiles),
      );
    }
    return this.truncateDiff(
      await this.chunkedDiff(git, [mergeBase], changedFiles),
    );
  }

  private async getFilteredDiffFiles(
    git: ReturnType<typeof simpleGit>,
    diffArgs: string[],
  ): Promise<string[]> {
    const nameOnly = await git.diff([...diffArgs, '--name-only']);
    if (!nameOnly.trim()) return [];
    const files = nameOnly.trim().split('\n');
    const filtered = files.filter((f) => !this.isSensitiveFile(f));
    const skipped = files.length - filtered.length;
    if (skipped > 0) {
      this.logger.warn(`Filtered ${skipped} sensitive file(s) from diff`);
    }
    return filtered;
  }

  /**
   * Run git diff in chunks to avoid ARG_MAX issues with large file lists.
   */
  private async chunkedDiff(
    git: ReturnType<typeof simpleGit>,
    baseArgs: string[],
    files: string[],
  ): Promise<string> {
    const parts: string[] = [];
    for (let i = 0; i < files.length; i += MAX_DIFF_FILE_ARGS) {
      const chunk = files.slice(i, i + MAX_DIFF_FILE_ARGS);
      parts.push(await git.diff([...baseArgs, '--', ...chunk]));
    }
    return parts.join('');
  }

  private truncateDiff(diff: string): string {
    if (diff.length <= MAX_DIFF_SIZE) return diff;
    this.logger.warn(
      `Diff size (${(diff.length / 1_048_576).toFixed(1)}MB) exceeds ${MAX_DIFF_SIZE / 1_048_576}MB limit, truncating`,
    );
    return diff.slice(0, MAX_DIFF_SIZE) + '\n...(diff truncated due to size)';
  }

  async readFiles(
    filePaths: string[],
    allowedRoot: string = process.cwd(),
  ): Promise<FileContent[]> {
    this.logger.log(`Reading ${filePaths.length} files`);
    const rootReal = await realpath(resolve(allowedRoot));
    const results: FileContent[] = [];
    let totalSize = 0;
    let skippedCount = 0;
    // Best-effort cumulative budget based on stat.size (not atomic across concurrent reads)
    const budget = { remaining: MAX_TOTAL_SIZE };

    const readOne = async (filePath: string): Promise<FileContent | null> => {
      const resolved = isAbsolute(filePath)
        ? filePath
        : resolve(rootReal, filePath);
      if (this.isSensitiveFile(resolved)) {
        this.logger.warn(`Skipping sensitive file: ${filePath}`);
        skippedCount++;
        return null;
      }
      let reserved = 0;
      try {
        const real = await realpath(resolved);
        if (!this.isWithinRoot(real, rootReal)) {
          this.logger.warn(`Skipping file outside allowed root: ${filePath}`);
          skippedCount++;
          return null;
        }
        if (this.isSensitiveFile(real)) {
          this.logger.warn(
            `Skipping sensitive file (symlink target): ${filePath}`,
          );
          skippedCount++;
          return null;
        }
        const fileStat = await stat(real);
        if (fileStat.size > MAX_FILE_SIZE) {
          this.logger.warn(
            `Skipping large file (${(fileStat.size / 1024 / 1024).toFixed(1)}MB): ${filePath}`,
          );
          skippedCount++;
          return null;
        }
        // Pre-check: skip reading if stat.size would exceed remaining budget
        if (fileStat.size > budget.remaining) {
          this.logger.warn(
            `Skipping file (cumulative size limit): ${filePath}`,
          );
          skippedCount++;
          return null;
        }
        // Deduct before reading to prevent concurrent over-allocation
        reserved = fileStat.size;
        budget.remaining -= reserved;
        const content = await readFile(real, 'utf-8');
        // Use relative path to avoid leaking host directory structure
        return { path: relative(rootReal, real), content };
      } catch (error) {
        budget.remaining += reserved;
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Skipping unreadable file: ${filePath} (${msg})`);
        skippedCount++;
        return null;
      }
    };

    for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
      const chunk = filePaths.slice(i, i + CONCURRENCY);
      const batch = await Promise.all(chunk.map(readOne));
      for (const item of batch) {
        if (item) {
          totalSize += Buffer.byteLength(item.content, 'utf-8');
          if (totalSize > MAX_TOTAL_SIZE) {
            this.logger.warn(
              `Cumulative size exceeded ${MAX_TOTAL_SIZE / 1_048_576}MB, stopping file reads`,
            );
            break;
          }
          results.push(item);
        }
      }
      if (totalSize > MAX_TOTAL_SIZE) break;
    }

    if (skippedCount > 0) {
      this.logger.log(
        `Read ${results.length} file(s), skipped ${skippedCount} file(s)`,
      );
    }

    if (results.length === 0) {
      throw new Error('No readable files found');
    }
    return results;
  }

  private resolveExtensions(options: CodebaseOptions): string[] {
    return options.extensions
      ? options.extensions.map((e) => (e.startsWith('.') ? e : `.${e}`))
      : this.extensions;
  }

  async readCodebase(
    directory: string,
    options: CodebaseOptions = {},
  ): Promise<FileContent[][]> {
    const extensions = this.resolveExtensions(options);
    const maxBatchSize = options.maxBatchSize ?? 100_000;

    this.logger.log(`Reading codebase: ${directory}`);
    const git = simpleGit(directory);

    const result = await git.raw([
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ]);

    const allFiles = [
      ...new Set(result.split('\0').filter((f) => f.length > 0)),
    ]
      .filter((f) => extensions.includes(extname(f)))
      .filter((f) => !this.isSensitiveFile(f));

    this.logger.log(`Found ${allFiles.length} files matching extensions`);

    let totalSize = 0;
    let skippedCount = 0;
    // Best-effort cumulative budget based on stat.size (not atomic across concurrent reads)
    const budget = { remaining: MAX_TOTAL_SIZE };

    const dirReal = await realpath(resolve(directory));

    const readOne = async (
      relativePath: string,
    ): Promise<FileContent | null> => {
      const fullPath = join(directory, relativePath);
      let reserved = 0;
      try {
        const real = await realpath(fullPath);
        if (!this.isWithinRoot(real, dirReal)) {
          this.logger.warn(
            `Skipping symlink pointing outside repo: ${relativePath}`,
          );
          skippedCount++;
          return null;
        }
        if (this.isSensitiveFile(real)) {
          this.logger.warn(
            `Skipping sensitive file (symlink target): ${relativePath}`,
          );
          skippedCount++;
          return null;
        }
        const fileStat = await stat(real);
        if (fileStat.size > MAX_FILE_SIZE) {
          this.logger.warn(
            `Skipping large file (${(fileStat.size / 1024 / 1024).toFixed(1)}MB): ${relativePath}`,
          );
          skippedCount++;
          return null;
        }
        // Pre-check: skip reading if stat.size would exceed remaining budget
        if (fileStat.size > budget.remaining) {
          this.logger.warn(
            `Skipping file (cumulative size limit): ${relativePath}`,
          );
          skippedCount++;
          return null;
        }
        // Deduct before reading to prevent concurrent over-allocation
        reserved = fileStat.size;
        budget.remaining -= reserved;
        const content = await readFile(real, 'utf-8');
        return { path: relativePath, content };
      } catch (error) {
        budget.remaining += reserved;
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Skipping unreadable file: ${relativePath} (${msg})`);
        skippedCount++;
        return null;
      }
    };

    const allItems: FileContent[] = [];
    let hitSizeLimit = false;
    for (let i = 0; i < allFiles.length && !hitSizeLimit; i += CONCURRENCY) {
      const chunk = allFiles.slice(i, i + CONCURRENCY);
      const readResults = await Promise.all(chunk.map(readOne));
      for (const item of readResults) {
        if (!item) continue;
        totalSize += Buffer.byteLength(item.content, 'utf-8');
        if (totalSize > MAX_TOTAL_SIZE) {
          this.logger.warn(
            `Cumulative size exceeded ${MAX_TOTAL_SIZE / 1_048_576}MB, stopping file reads`,
          );
          hitSizeLimit = true;
          break;
        }
        allItems.push(item);
      }
    }

    if (skippedCount > 0) {
      this.logger.log(
        `Read ${allItems.length} file(s), skipped ${skippedCount} file(s)`,
      );
    }

    if (allItems.length === 0) {
      throw new Error('No files found in codebase');
    }

    return this.createBatches(allItems, maxBatchSize);
  }

  async listCodebaseFiles(
    directory: string,
    options: CodebaseOptions = {},
  ): Promise<string[]> {
    const extensions = this.resolveExtensions(options);

    this.logger.log(`Listing codebase files: ${directory}`);
    const git = simpleGit(directory);

    const result = await git.raw([
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ]);

    const candidates = [
      ...new Set(result.split('\0').filter((f) => f.length > 0)),
    ]
      .filter((f) => extensions.includes(extname(f)))
      .filter((f) => !this.isSensitiveFile(f));

    // Verify symlinks stay within repo boundary (parallel batches)
    const dirReal = await realpath(resolve(directory));
    const files: string[] = [];
    let skippedCount = 0;

    const validateOne = async (f: string): Promise<string | null> => {
      try {
        const real = await realpath(join(directory, f));
        if (!this.isWithinRoot(real, dirReal)) {
          this.logger.warn(`Skipping symlink pointing outside repo: ${f}`);
          return null;
        }
        if (this.isSensitiveFile(real)) {
          this.logger.warn(`Skipping sensitive file (symlink target): ${f}`);
          return null;
        }
        return f;
      } catch {
        return null;
      }
    };

    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const chunk = candidates.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(validateOne));
      for (const f of results) {
        if (f) {
          files.push(f);
        } else {
          skippedCount++;
        }
      }
    }
    if (skippedCount > 0) {
      this.logger.warn(
        `Skipped ${skippedCount} file(s) during path validation`,
      );
    }

    this.logger.log(`Found ${files.length} files matching extensions`);

    if (files.length === 0) {
      throw new Error('No files found in codebase');
    }

    return files;
  }

  /**
   * Split files into batches by approximate size (chars, not bytes).
   * Character-based measurement is intentional: prompts are text, and
   * most LLM token counters correlate better with char count than byte count.
   */
  createBatches(
    items: FileContent[],
    maxBatchSize: number = 100_000,
  ): FileContent[][] {
    const batches: FileContent[][] = [];
    let currentBatch: FileContent[] = [];
    let currentBatchSize = 0;

    for (const item of items) {
      const fileSize = item.path.length + item.content.length;
      // File too large for a single batch — flush current and push as its own batch
      if (fileSize > maxBatchSize) {
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [];
          currentBatchSize = 0;
        }
        batches.push([item]);
        continue;
      }
      // Current batch would overflow — flush and start new batch
      if (
        currentBatchSize + fileSize > maxBatchSize &&
        currentBatch.length > 0
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchSize = 0;
      }
      currentBatch.push(item);
      currentBatchSize += fileSize;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  /** Cross-platform check: is `target` inside `root`? Uses path.relative to avoid separator issues. */
  private isWithinRoot(target: string, root: string): boolean {
    const rel = relative(root, target);
    return !rel.startsWith('..') && !isAbsolute(rel);
  }

  // Note: Path handling assumes POSIX separators. Windows backslashes are normalized to forward slashes.
  isSensitiveFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    const segments = normalized.split('/');
    const patterns = this.sensitivePatterns;
    return segments.some((segment) =>
      patterns.some((pattern) => pattern.test(segment)),
    );
  }
}
