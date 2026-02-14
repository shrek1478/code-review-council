import { Injectable, Logger } from '@nestjs/common';
import { simpleGit } from 'simple-git';
import { readFile } from 'node:fs/promises';

export interface FileContent {
  path: string;
  content: string;
}

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
}
