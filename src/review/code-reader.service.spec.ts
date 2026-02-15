import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { CodeReaderService } from './code-reader.service.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

describe('CodeReaderService', () => {
  let service: CodeReaderService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CodeReaderService, { provide: ConsoleLogger, useValue: new ConsoleLogger() }],
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

  describe('readCodebase', () => {
    it('should read git-tracked codebase files', async () => {
      const batches = await service.readCodebase(process.cwd());
      expect(batches.length).toBeGreaterThanOrEqual(1);
      const allFiles = batches.flat();
      expect(allFiles.length).toBeGreaterThan(0);
      const hasTsFile = allFiles.some((f) => f.path.endsWith('.ts'));
      expect(hasTsFile).toBe(true);
    });

    it('should filter by extensions', async () => {
      const batches = await service.readCodebase(process.cwd(), {
        extensions: ['.json'],
      });
      const allFiles = batches.flat();
      expect(allFiles.length).toBeGreaterThan(0);
      for (const file of allFiles) {
        expect(file.path).toMatch(/\.json$/);
      }
    });

    it('should split into batches with small batch size', async () => {
      const batches = await service.readCodebase(process.cwd(), {
        maxBatchSize: 500,
      });
      expect(batches.length).toBeGreaterThan(1);
    });

    it('should throw on invalid directory', async () => {
      await expect(
        service.readCodebase('/nonexistent/path'),
      ).rejects.toThrow();
    });
  });
});
