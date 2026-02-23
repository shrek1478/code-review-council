import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import {
  CodeReaderService,
  DEFAULT_EXCLUDE_PATTERNS,
} from './code-reader.service.js';
import { ConfigService } from '../config/config.service.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';

describe('CodeReaderService', () => {
  let service: CodeReaderService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CodeReaderService,
        { provide: ConsoleLogger, useValue: new ConsoleLogger() },
      ],
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
      await expect(service.readGitDiff(tmpDir, '--staged')).rejects.toThrow(
        'Invalid base branch name',
      );
    });
  });

  it('should read file contents', async () => {
    const testFile = fileURLToPath(import.meta.url);
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
      await writeFile(
        join(tmpDir, 'src', 'main.ts'),
        'const main = 2;\nexport default main;\n',
      );
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
      await expect(service.readCodebase('/nonexistent/path')).rejects.toThrow();
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

    it('should detect secret/credential files with precise matching', () => {
      expect(service.isSensitiveFile('config/secrets/db.json')).toBe(true);
      expect(service.isSensitiveFile('.secrets')).toBe(true);
      expect(service.isSensitiveFile('app-secret.yaml')).toBe(true);
      expect(service.isSensitiveFile('credentials.json')).toBe(true);
      expect(service.isSensitiveFile('db-credentials.yaml')).toBe(true);
    });

    it('should detect camelCase secret/credential files', () => {
      expect(service.isSensitiveFile('appSecret.json')).toBe(true);
      expect(service.isSensitiveFile('dbCredentials.xml')).toBe(true);
      expect(service.isSensitiveFile('clientsecret.json')).toBe(true);
      expect(service.isSensitiveFile('myCredential.yaml')).toBe(true);
      expect(service.isSensitiveFile('secretKey.ts')).toBe(true);
      expect(service.isSensitiveFile('credentialStore.json')).toBe(true);
    });

    it('should detect uppercase secret/credential files', () => {
      expect(service.isSensitiveFile('SECRETS.md')).toBe(true);
      expect(service.isSensitiveFile('DB_CREDENTIALS')).toBe(true);
      expect(service.isSensitiveFile('API_SECRET.env')).toBe(true);
    });

    it('should not falsely flag files containing secret/credential as substring', () => {
      expect(service.isSensitiveFile('src/secretary.ts')).toBe(false);
      expect(service.isSensitiveFile('lib/accreditation.ts')).toBe(false);
      expect(service.isSensitiveFile('src/secretariat.ts')).toBe(false);
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

  describe('isExcludedFile', () => {
    it('should exclude exact filename', () => {
      expect(
        service.isExcludedFile('node_modules/foo.ts', ['node_modules/**']),
      ).toBe(true);
    });
    it('should not exclude non-matching path', () => {
      expect(service.isExcludedFile('src/foo.ts', ['node_modules/**'])).toBe(
        false,
      );
    });
    it('should support * wildcard', () => {
      expect(service.isExcludedFile('dist/bundle.js', ['dist/*'])).toBe(true);
    });
    it('should support ? wildcard', () => {
      expect(service.isExcludedFile('src/a.ts', ['src/?.ts'])).toBe(true);
      expect(service.isExcludedFile('src/ab.ts', ['src/?.ts'])).toBe(false);
    });
    it('should match nested paths with **', () => {
      expect(service.isExcludedFile('a/b/c/foo.ts', ['a/**/foo.ts'])).toBe(
        true,
      );
    });
    it('should match dot files with ** pattern', () => {
      expect(service.isExcludedFile('.env', ['**'])).toBe(true);
      expect(service.isExcludedFile('config/.secrets', ['config/.*'])).toBe(
        true,
      );
    });
    it('should not match deep paths with single * wildcard', () => {
      expect(service.isExcludedFile('dist/a/b.js', ['dist/*'])).toBe(false);
    });
  });

  describe('resolveExcludePatterns fallback', () => {
    let tmpDir: string;
    let serviceWithThrowingConfig: CodeReaderService;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'cr-exclude-'));
      const git = simpleGit(tmpDir);
      await git.init();
      await git.addConfig('user.email', 'test@test.com');
      await git.addConfig('user.name', 'Test');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(join(tmpDir, 'src', 'app.ts'), 'const app = 1;\n');
      await writeFile(
        join(tmpDir, 'src', 'app.spec.ts'),
        'describe("app", () => {});\n',
      );
      await git.add('.');
      await git.commit('initial');

      const mockConfigService = {
        getConfig: vi.fn().mockImplementation(() => {
          throw new Error('Config not loaded. Call loadConfig() first.');
        }),
      };

      const module = await Test.createTestingModule({
        providers: [
          CodeReaderService,
          { provide: ConsoleLogger, useValue: new ConsoleLogger() },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      serviceWithThrowingConfig = module.get(CodeReaderService);
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should fall back to DEFAULT_EXCLUDE_PATTERNS when configService.getConfig() throws', async () => {
      const batches = await serviceWithThrowingConfig.readCodebase(tmpDir);
      const allFiles = batches.flat();
      // app.spec.ts should be excluded by DEFAULT_EXCLUDE_PATTERNS ('**/*.spec.ts')
      const hasSpecFile = allFiles.some((f) => f.path.includes('app.spec.ts'));
      expect(hasSpecFile).toBe(false);
      // app.ts should still be included
      const hasAppFile = allFiles.some((f) => f.path.includes('app.ts'));
      expect(hasAppFile).toBe(true);
    });
  });
});
