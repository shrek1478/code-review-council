import { Test } from '@nestjs/testing';
import { CodeReaderService } from './code-reader.service.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

describe('CodeReaderService', () => {
  let service: CodeReaderService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CodeReaderService],
    }).compile();
    service = module.get(CodeReaderService);
  });

  it('should read git diff from a repo', async () => {
    // Create a temp file to generate an unstaged diff
    const tmpFile = join(process.cwd(), '__test_diff_tmp__');
    await writeFile(tmpFile, 'test content\n');
    try {
      const diff = await service.readGitDiff(process.cwd(), 'HEAD');
      expect(typeof diff).toBe('string');
      expect(diff).toContain('__test_diff_tmp__');
    } finally {
      await unlink(tmpFile);
    }
  });

  it('should read file contents', async () => {
    const testFile = new URL(import.meta.url).pathname;
    const content = await service.readFiles([testFile]);
    expect(content.length).toBe(1);
    expect(content[0].content).toContain('CodeReaderService');
  });

  it('should throw on invalid repo path', async () => {
    await expect(
      service.readGitDiff('/nonexistent/path', 'main'),
    ).rejects.toThrow();
  });
});
