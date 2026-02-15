import { Injectable, ConsoleLogger, Inject } from '@nestjs/common';
import { simpleGit } from 'simple-git';
import { readFile, stat, realpath } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';

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
  /^\.env($|\.)/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /secret/i,
  /credential/i,
  /\.keystore$/,
];

const MAX_FILE_SIZE = 1_048_576; // 1MB
const MAX_TOTAL_SIZE = 200 * 1_048_576; // 200MB cumulative limit
const BRANCH_PATTERN = /^[A-Za-z0-9._\-/]+$/;
const CONCURRENCY = 16;

@Injectable()
export class CodeReaderService {
  constructor(@Inject(ConsoleLogger) private readonly logger: ConsoleLogger) {
    this.logger.setContext(CodeReaderService.name);
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
        if (!real.startsWith(rootReal + '/') && real !== rootReal) {
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
      } catch {
        this.logger.warn(`Skipping unreadable file: ${filePath}`);
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

  async readCodebase(
    directory: string,
    options: CodebaseOptions = {},
  ): Promise<FileContent[][]> {
    const extensions = (options.extensions ?? DEFAULT_EXTENSIONS).map((e) =>
      e.startsWith('.') ? e : `.${e}`,
    );
    const maxBatchSize = options.maxBatchSize ?? 100_000;

    this.logger.log(`Reading codebase: ${directory}`);
    const git = simpleGit(directory);

    const result = await git.raw([
      'ls-files',
      '--cached',
      '--exclude-standard',
    ]);

    const allFiles = result
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .filter((f) => extensions.includes(extname(f)))
      .filter((f) => !this.isSensitiveFile(f));

    this.logger.log(`Found ${allFiles.length} files matching extensions`);

    const files: FileContent[] = [];
    let totalSize = 0;

    const dirReal = await realpath(resolve(directory));

    const readOne = async (relativePath: string): Promise<FileContent | null> => {
      const fullPath = join(directory, relativePath);
      try {
        const real = await realpath(fullPath);
        if (!real.startsWith(dirReal + '/') && real !== dirReal) {
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
      } catch {
        this.logger.warn(`Skipping unreadable file: ${relativePath}`);
        return null;
      }
    };

    for (let i = 0; i < allFiles.length; i += CONCURRENCY) {
      const chunk = allFiles.slice(i, i + CONCURRENCY);
      const batch = await Promise.all(chunk.map(readOne));
      for (const item of batch) {
        if (item) {
          totalSize += item.content.length;
          if (totalSize > MAX_TOTAL_SIZE) {
            this.logger.warn(`Cumulative size exceeded ${MAX_TOTAL_SIZE / 1_048_576}MB, stopping file reads`);
            break;
          }
          files.push(item);
        }
      }
      if (totalSize > MAX_TOTAL_SIZE) break;
    }

    if (files.length === 0) {
      throw new Error('No files found in codebase');
    }

    return this.splitIntoBatches(files, maxBatchSize);
  }

  private isSensitiveFile(filePath: string): boolean {
    const segments = filePath.split('/');
    return segments.some((segment) =>
      SENSITIVE_PATTERNS.some((pattern) => pattern.test(segment)),
    );
  }

  private splitIntoBatches(
    files: FileContent[],
    maxChars: number,
  ): FileContent[][] {
    const batches: FileContent[][] = [];
    let currentBatch: FileContent[] = [];
    let currentSize = 0;

    for (const file of files) {
      const fileSize = file.path.length + file.content.length;

      if (fileSize > maxChars) {
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [];
          currentSize = 0;
        }
        batches.push([file]);
        continue;
      }

      if (currentSize + fileSize > maxChars && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentSize = 0;
      }

      currentBatch.push(file);
      currentSize += fileSize;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }
}
