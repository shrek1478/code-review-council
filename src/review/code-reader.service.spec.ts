import { Test } from '@nestjs/testing';
import { CodeReaderService } from './code-reader.service.js';
import { describe, it, expect, beforeEach } from 'vitest';

describe('CodeReaderService', () => {
  let service: CodeReaderService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CodeReaderService],
    }).compile();
    service = module.get(CodeReaderService);
  });

  it('should read git diff from a repo', async () => {
    // Use the current project's own repo for testing
    const diff = await service.readGitDiff(process.cwd(), 'HEAD');
    expect(typeof diff).toBe('string');
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
