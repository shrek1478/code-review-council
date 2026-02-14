import { Injectable, Logger } from '@nestjs/common';
import { simpleGit } from 'simple-git';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

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

@Injectable()
export class CodeReaderService {
  private readonly logger = new Logger(CodeReaderService.name);

  async readGitDiff(
    repoPath: string,
    baseBranch: string = 'main',
  ): Promise<string> {
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

  async readFiles(filePaths: string[]): Promise<FileContent[]> {
    this.logger.log(`Reading ${filePaths.length} files`);
    const results: FileContent[] = [];
    for (const filePath of filePaths) {
      const content = await readFile(filePath, 'utf-8');
      results.push({ path: filePath, content });
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
      '--others',
      '--exclude-standard',
    ]);

    const allFiles = result
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .filter((f) => extensions.includes(extname(f)));

    this.logger.log(`Found ${allFiles.length} files matching extensions`);

    const files: FileContent[] = [];
    for (const relativePath of allFiles) {
      const fullPath = join(directory, relativePath);
      try {
        const content = await readFile(fullPath, 'utf-8');
        files.push({ path: relativePath, content });
      } catch {
        this.logger.warn(`Skipping unreadable file: ${relativePath}`);
      }
    }

    if (files.length === 0) {
      throw new Error('No files found in codebase');
    }

    return this.splitIntoBatches(files, maxBatchSize);
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
