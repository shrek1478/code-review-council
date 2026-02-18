import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { CodeReaderService } from './code-reader.service.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';

describe('CodeReaderService', () => {
  let service: CodeReaderService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CodeReaderService, { provide: ConsoleLogger, useValue: new ConsoleLogger() }],
    }).compile();
    service = module.get(CodeReaderService);
  });

  describe('readGitDiff', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'cr-test-'));
      const git = simpleGit(tmpDir);
      await git.init();
      await git.addConfig('user.email', 'test@test.com');
      await git.addConfig('user.name', 'Test');
      await writeFile(join(tmpDir, 'initial.txt'), 'initial\n');
      await git.add('initial.txt');
      await git.commit('initial commit');
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should read git diff from a repo', async () => {
      await writeFile(join(tmpDir, 'initial.txt'), 'modified content\n');
      const diff = await service.readGitDiff(tmpDir, 'HEAD');
      expect(typeof diff).toBe('string');
      expect(diff).toContain('modified content');
    });

    it('should read staged diff when no unstaged changes', async () => {
      await writeFile(join(tmpDir, 'new.txt'), 'staged content\n');
      const git = simpleGit(tmpDir);
      await git.add('new.txt');
      const diff = await service.readGitDiff(tmpDir, 'HEAD');
      expect(diff).toContain('staged content');
    });

    it('should reject branch names starting with dash', async () => {
      await expect(
        service.readGitDiff(tmpDir, '--staged'),
      ).rejects.toThrow('Invalid base branch name');
    });
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
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'cr-codebase-'));
      const git = simpleGit(tmpDir);
      await git.init();
      await git.addConfig('user.email', 'test@test.com');
      await git.addConfig('user.name', 'Test');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(join(tmpDir, 'src', 'app.ts'), 'const app = 1;\n');
      await writeFile(join(tmpDir, 'src', 'main.ts'), 'const main = 2;\nexport default main;\n');
      await writeFile(join(tmpDir, 'package.json'), '{"name": "test"}\n');
      await git.add('.');
      await git.commit('initial');
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should read git-tracked codebase files', async () => {
      const batches = await service.readCodebase(tmpDir);
      expect(batches.length).toBeGreaterThanOrEqual(1);
      const allFiles = batches.flat();
      expect(allFiles.length).toBe(3);
      const hasTsFile = allFiles.some((f) => f.path.endsWith('.ts'));
      expect(hasTsFile).toBe(true);
    });

    it('should filter by extensions', async () => {
      const batches = await service.readCodebase(tmpDir, {
        extensions: ['.json'],
      });
      const allFiles = batches.flat();
      expect(allFiles.length).toBe(1);
      expect(allFiles[0].path).toMatch(/\.json$/);
    });

    it('should split into batches with small batch size', async () => {
      const batches = await service.readCodebase(tmpDir, {
        maxBatchSize: 20,
      });
      expect(batches.length).toBeGreaterThan(1);
    });

    it('should throw on invalid directory', async () => {
      await expect(
        service.readCodebase('/nonexistent/path'),
      ).rejects.toThrow();
    });
  });

  describe('listCodebaseFiles', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'cr-list-'));
      const git = simpleGit(tmpDir);
      await git.init();
      await git.addConfig('user.email', 'test@test.com');
      await git.addConfig('user.name', 'Test');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(join(tmpDir, 'src', 'app.ts'), 'const app = 1;\n');
      await writeFile(join(tmpDir, 'src', 'main.ts'), 'const main = 2;\n');
      await writeFile(join(tmpDir, 'README.md'), '# readme\n');
      await git.add('.');
      await git.commit('initial');
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should list git-tracked files without reading content', async () => {
      const files = await service.listCodebaseFiles(tmpDir);
      expect(files.length).toBe(2); // only .ts files match default extensions
      const hasTsFile = files.some((f) => f.endsWith('.ts'));
      expect(hasTsFile).toBe(true);
      for (const f of files) {
        expect(typeof f).toBe('string');
      }
    });

    it('should filter by extensions', async () => {
      const files = await service.listCodebaseFiles(tmpDir, {
        extensions: ['.ts'],
      });
      expect(files.length).toBe(2);
      for (const file of files) {
        expect(file).toMatch(/\.ts$/);
      }
    });

    it('should throw on invalid directory', async () => {
      await expect(
        service.listCodebaseFiles('/nonexistent/path'),
      ).rejects.toThrow();
    });
  });

  describe('isSensitiveFile', () => {
    it('should detect .env files', () => {
      expect(service.isSensitiveFile('.env')).toBe(true);
      expect(service.isSensitiveFile('.env.local')).toBe(true);
      expect(service.isSensitiveFile('src/.env.production')).toBe(true);
    });

    it('should detect key/pem files', () => {
      expect(service.isSensitiveFile('certs/server.pem')).toBe(true);
      expect(service.isSensitiveFile('ssl/private.key')).toBe(true);
    });

    it('should handle Windows-style paths', () => {
      expect(service.isSensitiveFile('src\\.env')).toBe(true);
      expect(service.isSensitiveFile('config\\secrets\\db.json')).toBe(true);
    });

    it('should not flag normal files', () => {
      expect(service.isSensitiveFile('src/app.ts')).toBe(false);
      expect(service.isSensitiveFile('package.json')).toBe(false);
    });
  });
});
