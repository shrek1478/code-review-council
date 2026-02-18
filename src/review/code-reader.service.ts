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
  '.ts', '.js', '.tsx', '.jsx',
  '.py', '.go', '.java', '.kt',
  '.rs', '.rb', '.php', '.cs',
  '.swift', '.c', '.cpp', '.h',
  '.vue', '.svelte', '.html', '.css', '.scss',
  '.json', '.yaml', '.yml',
];

const SENSITIVE_PATTERNS = [
  /^\.env($|\.)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(^|[^A-Z])[Ss][Ee][Cc][Rr][Ee][Tt]s?($|[^a-z])/,
  /(^|[^A-Z])[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]s?($|[^a-z])/,
  /\.keystore$/i,
];

const MAX_FILE_SIZE = 1_048_576; // 1MB
const MAX_TOTAL_SIZE = 200 * 1_048_576; // 200MB cumulative limit
const BRANCH_PATTERN = /^[A-Za-z0-9._\-/]+$/;
const CONCURRENCY = 16;

@Injectable()
export class CodeReaderService {
  constructor(
    @Inject(ConsoleLogger) private readonly logger: ConsoleLogger,
    @Optional() @Inject(ConfigService) private readonly configService?: ConfigService,
  ) {
    this.logger.setContext(CodeReaderService.name);
  }

  private get extensions(): string[] {
    const configured = this.configService?.getConfig()?.review?.extensions;
    return (configured ?? DEFAULT_EXTENSIONS).map((e) =>
      e.startsWith('.') ? e : `.${e}`,
    );
  }

  private get sensitivePatterns(): RegExp[] {
    const configured = this.configService?.getConfig()?.review?.sensitivePatterns;
    if (configured) {
      // Merge user-defined patterns with defaults
      const userPatterns = configured.map((p) => new RegExp(p));
      return [...SENSITIVE_PATTERNS, ...userPatterns];
    }
    return SENSITIVE_PATTERNS;
  }

  async readGitDiff(
    repoPath: string,
    baseBranch: string = 'main',
  ): Promise<string> {
    if (!BRANCH_PATTERN.test(baseBranch) || baseBranch.startsWith('-')) {
      throw new Error(`Invalid base branch name: "${baseBranch}"`);
    }
    this.logger.log(`Reading git diff: ${repoPath} (base: ${baseBranch})`);
    const git = simpleGit(repoPath);
    const diff = await git.diff([baseBranch]);
    if (!diff) {
      const diffStaged = await git.diff(['--staged']);
      if (!diffStaged) {
        throw new Error('No diff found');
      }
      return diffStaged;
    }
    return diff;
  }

  async readFiles(
    filePaths: string[],
    allowedRoot: string = process.cwd(),
  ): Promise<FileContent[]> {
    this.logger.log(`Reading ${filePaths.length} files`);
    const rootReal = await realpath(resolve(allowedRoot));
    const results: FileContent[] = [];
    let totalSize = 0;

    const readOne = async (filePath: string): Promise<FileContent | null> => {
      const resolved = resolve(filePath);
      if (this.isSensitiveFile(resolved)) {
        this.logger.warn(`Skipping sensitive file: ${filePath}`);
        return null;
      }
      try {
        const real = await realpath(resolved);
        if (!this.isWithinRoot(real, rootReal)) {
          this.logger.warn(`Skipping file outside allowed root: ${filePath}`);
          return null;
        }
        const fileStat = await stat(real);
        if (fileStat.size > MAX_FILE_SIZE) {
          this.logger.warn(
            `Skipping large file (${(fileStat.size / 1024 / 1024).toFixed(1)}MB): ${filePath}`,
          );
          return null;
        }
        const content = await readFile(real, 'utf-8');
        return { path: filePath, content };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Skipping unreadable file: ${filePath} (${msg})`);
        return null;
      }
    };

    for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
      const chunk = filePaths.slice(i, i + CONCURRENCY);
      const batch = await Promise.all(chunk.map(readOne));
      for (const item of batch) {
        if (item) {
          totalSize += item.content.length;
          if (totalSize > MAX_TOTAL_SIZE) {
            this.logger.warn(`Cumulative size exceeded ${MAX_TOTAL_SIZE / 1_048_576}MB, stopping file reads`);
            break;
          }
          results.push(item);
        }
      }
      if (totalSize > MAX_TOTAL_SIZE) break;
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

    const allFiles = [...new Set(result
      .split('\0')
      .filter((f) => f.length > 0))]
      .filter((f) => extensions.includes(extname(f)))
      .filter((f) => !this.isSensitiveFile(f));

    this.logger.log(`Found ${allFiles.length} files matching extensions`);

    let totalSize = 0;

    const dirReal = await realpath(resolve(directory));

    const readOne = async (relativePath: string): Promise<FileContent | null> => {
      const fullPath = join(directory, relativePath);
      try {
        const real = await realpath(fullPath);
        if (!this.isWithinRoot(real, dirReal)) {
          this.logger.warn(`Skipping symlink pointing outside repo: ${relativePath}`);
          return null;
        }
        const fileStat = await stat(real);
        if (fileStat.size > MAX_FILE_SIZE) {
          this.logger.warn(`Skipping large file (${(fileStat.size / 1024 / 1024).toFixed(1)}MB): ${relativePath}`);
          return null;
        }
        const content = await readFile(real, 'utf-8');
        return { path: relativePath, content };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Skipping unreadable file: ${relativePath} (${msg})`);
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
        totalSize += item.content.length;
        if (totalSize > MAX_TOTAL_SIZE) {
          this.logger.warn(`Cumulative size exceeded ${MAX_TOTAL_SIZE / 1_048_576}MB, stopping file reads`);
          hitSizeLimit = true;
          break;
        }
        allItems.push(item);
      }
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

    const candidates = [...new Set(result
      .split('\0')
      .filter((f) => f.length > 0))]
      .filter((f) => extensions.includes(extname(f)))
      .filter((f) => !this.isSensitiveFile(f));

    // Verify symlinks stay within repo boundary
    const dirReal = await realpath(resolve(directory));
    const files: string[] = [];
    for (const f of candidates) {
      try {
        const real = await realpath(join(directory, f));
        if (!this.isWithinRoot(real, dirReal)) {
          this.logger.warn(`Skipping symlink pointing outside repo: ${f}`);
          continue;
        }
      } catch {
        // Unresolvable path (broken symlink, etc.) — skip silently
        continue;
      }
      files.push(f);
    }

    this.logger.log(`Found ${files.length} files matching extensions`);

    if (files.length === 0) {
      throw new Error('No files found in codebase');
    }

    return files;
  }

  private createBatches(items: FileContent[], maxBatchSize: number): FileContent[][] {
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
      if (currentBatchSize + fileSize > maxBatchSize && currentBatch.length > 0) {
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
