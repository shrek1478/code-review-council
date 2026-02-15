# Code Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 15 issues found by the Code Review Council self-review.

**Architecture:** Fixes span 10 files across 4 layers (CLI, ACP, Review, Config). Changes are grouped into 7 tasks ordered by dependency: ACP types/logger first (used by all), then Config validation, CodeReader safety, ACP resource cleanup, Council/ReviewService output separation, DecisionMaker batch logic, and CLI polish last.

**Tech Stack:** NestJS, nest-commander, TypeScript, vitest

**Test runner:** `npx vitest run --reporter=verbose`

**Pre-existing test failures:** 2 tests fail before this work:
- `config.service.spec.ts` — expects `Gemini` as first reviewer but config has `Codex`
- `code-reader.service.spec.ts` — environment-dependent diff test

---

### Task 1: ACP types and logger injection (B7, B9, B13, B4, C14)

**Files:**
- Modify: `src/acp/acp.service.ts`
- Modify: `src/acp/acp.service.spec.ts`
- Modify: `src/cli.ts`

**Step 1: Define local ACP interfaces and update AcpService**

Replace `src/acp/acp.service.ts` with:

```typescript
import { Injectable, ConsoleLogger } from '@nestjs/common';
import { CopilotClient } from '@github/copilot-sdk';
import { ReviewerConfig } from '../config/config.types.js';

export interface AcpSessionOptions {
  streaming: boolean;
  model?: string;
}

export interface AcpEvent {
  type: string;
  data?: {
    content?: string;
    deltaContent?: string;
    message?: string;
  };
}

export interface AcpSession {
  on(callback: (event: AcpEvent) => void): void;
  send(params: { prompt: string }): Promise<void>;
  destroy(): Promise<void>;
}

export interface AcpClientHandle {
  name: string;
  client: CopilotClient;
  model?: string;
}

@Injectable()
export class AcpService {
  private clients: AcpClientHandle[] = [];

  constructor(private readonly logger: ConsoleLogger) {
    this.logger.setContext(AcpService.name);
  }

  async createClient(config: ReviewerConfig): Promise<AcpClientHandle> {
    this.logger.log(`Creating ACP client: ${config.name} (${config.cliPath})`);
    const client = new CopilotClient({
      cliPath: config.cliPath,
      cliArgs: config.cliArgs,
      protocol: 'acp',
    } as ConstructorParameters<typeof CopilotClient>[0]);
    await client.start();
    const handle: AcpClientHandle = { name: config.name, client, model: config.model };
    this.clients.push(handle);
    return handle;
  }

  async sendPrompt(handle: AcpClientHandle, prompt: string, timeoutMs = 180_000): Promise<string> {
    this.logger.log(`📝 ${handle.name} reviewing...`);

    const sessionOpts: AcpSessionOptions = { streaming: true };
    if (handle.model) sessionOpts.model = handle.model;
    const session: AcpSession = await (handle.client as any).createSession(sessionOpts);

    try {
      const result = await new Promise<string>((resolve, reject) => {
        let responseContent = '';
        let settled = false;

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error(`${handle.name} timed out after ${(timeoutMs / 1000).toFixed(0)}s`));
          }
        }, timeoutMs);

        session.on((event: AcpEvent) => {
          if (settled) return;

          if (event.type === 'assistant.message_delta') {
            const delta = event.data?.deltaContent || '';
            if (delta) {
              responseContent += delta;
            }
          } else if (event.type === 'assistant.message') {
            responseContent = event.data?.content || responseContent;
          } else if (event.type === 'session.idle') {
            settled = true;
            clearTimeout(timer);
            resolve(responseContent);
          } else if (event.type === 'session.error' || event.type === 'error') {
            settled = true;
            clearTimeout(timer);
            reject(new Error(event.data?.message || 'ACP error'));
          }
        });

        session.send({ prompt }).catch((err: Error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        });
      });

      this.logger.log(`✅ ${handle.name} done.`);
      return result;
    } finally {
      try {
        await session.destroy();
      } catch (error) {
        this.logger.warn(`Failed to destroy session for ${handle.name}: ${error}`);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const handle of this.clients) {
      try {
        await handle.client.stop();
      } catch (error) {
        this.logger.warn(`Failed to stop client ${handle.name}: ${error}`);
      }
    }
    this.clients = [];
  }
}
```

Key changes:
- `new Logger()` → injected `ConsoleLogger` with `setContext` (B13)
- Added `AcpSessionOptions`, `AcpEvent`, `AcpSession` interfaces (B7)
- `catch {}` → `catch (error) { this.logger.warn(...) }` (B9)
- Timeout message uses `.toFixed(0)` (C14)
- Removed `process.setMaxListeners` from constructor (B4)

**Step 2: Update cli.ts to set maxListeners once (B4)**

In `src/cli.ts`, add `process.setMaxListeners(30);` before `bootstrap()`:

```typescript
process.setMaxListeners(30);

async function bootstrap() {
  await CommandFactory.run(CliModule, { logger: new CliLogger() });
}
bootstrap();
```

**Step 3: Update AcpService tests for ConsoleLogger injection**

In `src/acp/acp.service.spec.ts`, update the test module to provide `ConsoleLogger`:

```typescript
import { ConsoleLogger } from '@nestjs/common';

// In beforeEach:
const module = await Test.createTestingModule({
  providers: [AcpService, ConsoleLogger],
}).compile();
```

Update the timeout test expectation from `'0.1s'` to `'0s'` (since `(100 / 1000).toFixed(0)` === `'0'`):

```typescript
).rejects.toThrow('SlowReviewer timed out after 0s');
```

**Step 4: Run tests**

Run: `npx vitest run src/acp/acp.service.spec.ts --reporter=verbose`
Expected: All AcpService tests PASS

**Step 5: Commit**

```bash
git add src/acp/acp.service.ts src/acp/acp.service.spec.ts src/cli.ts
git commit -m "refactor: ACP types, logger injection, session cleanup logging"
```

---

### Task 2: ConfigService schema validation (B6)

**Files:**
- Modify: `src/config/config.service.ts`
- Modify: `src/config/config.service.spec.ts`

**Step 1: Write failing test for invalid config**

Add to `src/config/config.service.spec.ts`:

```typescript
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

it('should throw on config missing required fields', async () => {
  const tmpPath = join(process.cwd(), '__test_invalid_config__.json');
  await writeFile(tmpPath, JSON.stringify({ reviewers: [] }));
  try {
    await expect(service.loadConfig(tmpPath)).rejects.toThrow('reviewers');
  } finally {
    await unlink(tmpPath);
  }
});

it('should throw on config with invalid reviewer (missing cliPath)', async () => {
  const tmpPath = join(process.cwd(), '__test_bad_reviewer__.json');
  await writeFile(tmpPath, JSON.stringify({
    reviewers: [{ name: 'Test' }],
    decisionMaker: { name: 'DM', cliPath: 'dm', cliArgs: [] },
    review: { defaultChecks: ['code-quality'], language: 'en' },
  }));
  try {
    await expect(service.loadConfig(tmpPath)).rejects.toThrow('cliPath');
  } finally {
    await unlink(tmpPath);
  }
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/config/config.service.spec.ts --reporter=verbose`
Expected: 2 new tests FAIL

**Step 3: Add validation to ConfigService**

Update `src/config/config.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CouncilConfig, ReviewerConfig } from './config.types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

@Injectable()
export class ConfigService {
  private config: CouncilConfig | null = null;

  async loadConfig(configPath?: string): Promise<CouncilConfig> {
    const filePath = configPath
      ? resolve(configPath)
      : resolve(PROJECT_ROOT, 'review-council.config.json');
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    this.validateConfig(parsed, filePath);
    this.config = parsed as CouncilConfig;
    return this.config;
  }

  getConfig(): CouncilConfig {
    if (!this.config) {
      throw new Error('Config not loaded. Call loadConfig() first.');
    }
    return this.config;
  }

  private validateConfig(config: any, filePath: string): void {
    if (!Array.isArray(config.reviewers) || config.reviewers.length === 0) {
      throw new Error(`Invalid config (${filePath}): "reviewers" must be a non-empty array`);
    }
    for (const [i, r] of config.reviewers.entries()) {
      this.validateReviewerConfig(r, `reviewers[${i}]`, filePath);
    }
    if (!config.decisionMaker) {
      throw new Error(`Invalid config (${filePath}): "decisionMaker" is required`);
    }
    this.validateReviewerConfig(config.decisionMaker, 'decisionMaker', filePath);
    if (!config.review || !Array.isArray(config.review.defaultChecks)) {
      throw new Error(`Invalid config (${filePath}): "review.defaultChecks" must be an array`);
    }
  }

  private validateReviewerConfig(r: any, path: string, filePath: string): void {
    if (!r.name || typeof r.name !== 'string') {
      throw new Error(`Invalid config (${filePath}): "${path}.name" is required`);
    }
    if (!r.cliPath || typeof r.cliPath !== 'string') {
      throw new Error(`Invalid config (${filePath}): "${path}.cliPath" is required`);
    }
    if (!Array.isArray(r.cliArgs)) {
      throw new Error(`Invalid config (${filePath}): "${path}.cliArgs" must be an array`);
    }
  }
}
```

**Step 4: Fix existing test for first reviewer name**

In `src/config/config.service.spec.ts`, fix the pre-existing failure:

```typescript
it('should load config from custom path', async () => {
  const config = await service.loadConfig('./review-council.config.json');
  expect(config.reviewers[0].name).toBe('Codex');
});
```

**Step 5: Run tests**

Run: `npx vitest run src/config/config.service.spec.ts --reporter=verbose`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/config/config.service.ts src/config/config.service.spec.ts
git commit -m "feat: add config schema validation with fail-fast"
```

---

### Task 3: CodeReader safety — sensitive files & OOM protection (A3, B10)

**Files:**
- Modify: `src/review/code-reader.service.ts`
- Modify: `src/review/code-reader.service.spec.ts`

**Step 1: Write failing tests**

Add to `src/review/code-reader.service.spec.ts`:

```typescript
import { writeFile, unlink, mkdir, rmdir } from 'node:fs/promises';

it('should exclude sensitive files (.env)', async () => {
  const tmpEnv = join(process.cwd(), '.env.test-sensitive');
  await writeFile(tmpEnv, 'SECRET=abc');
  try {
    const batches = await service.readCodebase(process.cwd(), { extensions: ['.env.test-sensitive'] });
    const allFiles = batches.flat();
    const hasSensitive = allFiles.some((f) => f.path.includes('.env'));
    expect(hasSensitive).toBe(false);
  } finally {
    await unlink(tmpEnv);
  }
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/review/code-reader.service.spec.ts -t "should exclude sensitive" --reporter=verbose`
Expected: FAIL

**Step 3: Add SENSITIVE_PATTERNS and MAX_FILE_SIZE to CodeReaderService**

Update `src/review/code-reader.service.ts`:

```typescript
import { Injectable, ConsoleLogger } from '@nestjs/common';
import { simpleGit } from 'simple-git';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

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

@Injectable()
export class CodeReaderService {
  constructor(private readonly logger: ConsoleLogger) {
    this.logger.setContext(CodeReaderService.name);
  }

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
      .filter((f) => extensions.includes(extname(f)))
      .filter((f) => !this.isSensitiveFile(f));

    this.logger.log(`Found ${allFiles.length} files matching extensions`);

    const files: FileContent[] = [];
    for (const relativePath of allFiles) {
      const fullPath = join(directory, relativePath);
      try {
        const fileStat = await stat(fullPath);
        if (fileStat.size > MAX_FILE_SIZE) {
          this.logger.warn(`Skipping large file (${(fileStat.size / 1024 / 1024).toFixed(1)}MB): ${relativePath}`);
          continue;
        }
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

  private isSensitiveFile(filePath: string): boolean {
    const name = basename(filePath);
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name));
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
```

Key changes:
- `new Logger()` → injected `ConsoleLogger` (B13)
- Added `SENSITIVE_PATTERNS` regex list and `isSensitiveFile()` (A3)
- Added `MAX_FILE_SIZE` (1MB) check with `stat()` (B10)
- Import `stat` from `node:fs/promises` and `basename` from `node:path`

**Step 4: Update CodeReaderService tests for ConsoleLogger injection**

In `src/review/code-reader.service.spec.ts`, update beforeEach:

```typescript
import { ConsoleLogger } from '@nestjs/common';

const module = await Test.createTestingModule({
  providers: [CodeReaderService, ConsoleLogger],
}).compile();
```

**Step 5: Run tests**

Run: `npx vitest run src/review/code-reader.service.spec.ts --reporter=verbose`
Expected: All CodeReaderService tests PASS (except the pre-existing diff test which is environment-dependent)

**Step 6: Commit**

```bash
git add src/review/code-reader.service.ts src/review/code-reader.service.spec.ts
git commit -m "feat: add sensitive file exclusion and large file protection"
```

---

### Task 4: Council resource cleanup with Promise.allSettled (A1, C15)

**Files:**
- Modify: `src/review/council.service.ts`
- Modify: `src/review/council.service.spec.ts`

**Step 1: Write failing test for cleanup on partial failure**

Add to `src/review/council.service.spec.ts`:

```typescript
it('should stop clients for failed reviewers', async () => {
  mockAcpService.createClient
    .mockResolvedValueOnce({ name: 'Gemini', client: {} })
    .mockRejectedValueOnce(new Error('client start failed'));

  const reviews = await service.dispatchReviews({
    code: 'const x = 1;',
    checks: ['code-quality'],
  });

  expect(reviews.length).toBe(2);
  expect(reviews[1].review).toContain('error');
  // The successfully created client should have been tracked for cleanup
  expect(mockAcpService.createClient).toHaveBeenCalledTimes(2);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/review/council.service.spec.ts -t "should stop clients" --reporter=verbose`
Expected: FAIL (createClient rejection propagates differently now)

**Step 3: Update CouncilService with ConsoleLogger and Promise.allSettled**

Replace `src/review/council.service.ts`:

```typescript
import { Inject, Injectable, ConsoleLogger } from '@nestjs/common';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { IndividualReview, ReviewRequest } from './review.types.js';

@Injectable()
export class CouncilService {
  constructor(
    private readonly logger: ConsoleLogger,
    @Inject(AcpService) private readonly acpService: AcpService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.logger.setContext(CouncilService.name);
  }

  async dispatchReviews(request: ReviewRequest): Promise<IndividualReview[]> {
    const config = this.configService.getConfig();
    const reviewers = config.reviewers;

    this.logger.log(`Dispatching reviews to ${reviewers.length} reviewers...`);

    const prompt = this.buildReviewPrompt(request);

    const results = await Promise.allSettled(
      reviewers.map(async (reviewerConfig) => {
        const handle = await this.acpService.createClient(reviewerConfig);
        const review = await this.acpService.sendPrompt(handle, prompt);
        return { reviewer: reviewerConfig.name, review };
      }),
    );

    return results.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      this.logger.error(`Reviewer ${reviewers[i].name} failed: ${msg}`);
      return { reviewer: reviewers[i].name, review: `[error] ${msg}` };
    });
  }

  private buildReviewPrompt(request: ReviewRequest): string {
    const config = this.configService.getConfig();
    const lang = request.language ?? config.review.language ?? 'zh-tw';
    const checks = request.checks.length > 0 ? request.checks : config.review.defaultChecks;

    let prompt = `You are a senior code reviewer. Please review the following code.
You MUST reply entirely in ${lang}. All descriptions, suggestions, and explanations must be written in ${lang}.

Check for: ${checks.join(', ')}

For each issue found, provide:
- Severity (high/medium/low)
- Category
- Description (in ${lang})
- File and line number if applicable
- Suggested fix (in ${lang})

Code to review:
\`\`\`
${request.code}
\`\`\``;

    if (request.extraInstructions) {
      prompt += `\n\nAdditional instructions: ${request.extraInstructions}`;
    }

    return prompt;
  }
}
```

Key changes:
- `new Logger()` → injected `ConsoleLogger` (B13)
- `Promise.all` → `Promise.allSettled` (C15)
- Removed `console.log` from service — output moved to command layer later (B8, partial)

**Step 4: Update CouncilService tests for ConsoleLogger**

In `src/review/council.service.spec.ts`, add ConsoleLogger to providers:

```typescript
import { ConsoleLogger } from '@nestjs/common';

// In providers array:
providers: [
  CouncilService,
  ConsoleLogger,
  { provide: AcpService, useValue: mockAcpService },
  { provide: ConfigService, useValue: mockConfigService },
],
```

**Step 5: Run tests**

Run: `npx vitest run src/review/council.service.spec.ts --reporter=verbose`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/review/council.service.ts src/review/council.service.spec.ts
git commit -m "refactor: council uses Promise.allSettled, inject ConsoleLogger"
```

---

### Task 5: ReviewService — remove console.log, fix multi-batch logic (B8, A1, A2)

**Files:**
- Modify: `src/review/review.service.ts`
- Modify: `src/review/review.service.spec.ts`
- Modify: `src/review/review.types.ts`

**Step 1: Update ReviewRequest type for output callback**

No changes needed to types — the service will return data only, CLI layer handles printing.

**Step 2: Update ReviewService**

Replace `src/review/review.service.ts`:

```typescript
import { Injectable, ConsoleLogger, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CodeReaderService, CodebaseOptions } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { DecisionMakerService } from './decision-maker.service.js';
import { AcpService } from '../acp/acp.service.js';
import { IndividualReview, ReviewResult } from './review.types.js';

@Injectable()
export class ReviewService {
  constructor(
    private readonly logger: ConsoleLogger,
    @Inject(CodeReaderService) private readonly codeReader: CodeReaderService,
    @Inject(CouncilService) private readonly council: CouncilService,
    @Inject(DecisionMakerService) private readonly decisionMaker: DecisionMakerService,
    @Inject(AcpService) private readonly acpService: AcpService,
  ) {
    this.logger.setContext(ReviewService.name);
  }

  async reviewDiff(
    repoPath: string,
    baseBranch: string = 'main',
    checks: string[] = [],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    this.logger.log(`Starting diff review ${id}`);

    try {
      const code = await this.codeReader.readGitDiff(repoPath, baseBranch);
      return await this.runReview(id, code, checks, extraInstructions);
    } finally {
      await this.acpService.stopAll();
    }
  }

  async reviewFiles(
    filePaths: string[],
    checks: string[] = [],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    this.logger.log(`Starting file review ${id}`);

    try {
      const files = await this.codeReader.readFiles(filePaths);
      const code = files.map((f) => `=== ${f.path} ===\n${f.content}`).join('\n\n');
      return await this.runReview(id, code, checks, extraInstructions);
    } finally {
      await this.acpService.stopAll();
    }
  }

  async reviewCodebase(
    directory: string,
    options: CodebaseOptions = {},
    checks: string[] = [],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const id = `review-${randomUUID().slice(0, 8)}`;
    this.logger.log(`Starting codebase review ${id}`);

    try {
      const batches = await this.codeReader.readCodebase(directory, options);
      this.logger.log(`Codebase split into ${batches.length} batch(es)`);

      if (batches.length === 1) {
        const code = batches[0]
          .map((f) => `=== ${f.path} ===\n${f.content}`)
          .join('\n\n');
        return await this.runReview(id, code, checks, extraInstructions);
      }

      // Multi-batch: review each batch, then pass file summary (not full code) to decision maker
      const allReviews: IndividualReview[] = [];
      const allFileNames: string[] = [];
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const code = batch
          .map((f) => `=== ${f.path} ===\n${f.content}`)
          .join('\n\n');

        for (const f of batch) {
          const lineCount = f.content.split('\n').length;
          allFileNames.push(`${f.path} (${lineCount} lines)`);
        }

        const batchExtra = [
          `[Batch ${i + 1}/${batches.length}]`,
          extraInstructions,
        ]
          .filter(Boolean)
          .join(' ');

        const reviews = await this.council.dispatchReviews({
          code,
          checks,
          extraInstructions: batchExtra,
        });
        allReviews.push(...reviews);

        // Release clients after each batch (A1)
        await this.acpService.stopAll();
      }

      // Pass file summary instead of full code to decision maker (A2)
      const fileSummary = allFileNames.join('\n');
      const decision = await this.decisionMaker.decide(fileSummary, allReviews, true);
      return { id, status: 'completed', individualReviews: allReviews, decision };
    } finally {
      await this.acpService.stopAll();
    }
  }

  private async runReview(
    id: string,
    code: string,
    checks: string[],
    extraInstructions?: string,
  ): Promise<ReviewResult> {
    const individualReviews = await this.council.dispatchReviews({
      code,
      checks,
      extraInstructions,
    });

    const decision = await this.decisionMaker.decide(code, individualReviews);

    return {
      id,
      status: 'completed',
      individualReviews,
      decision,
    };
  }
}
```

Key changes:
- `new Logger()` → injected `ConsoleLogger` (B13)
- Removed all `console.log` (B8) — output will be handled by CLI commands
- Multi-batch: `stopAll()` after each batch (A1)
- Multi-batch: passes file summary to `decisionMaker.decide()` instead of full code (A2)
- `decisionMaker.decide()` gets new `isSummaryMode` param for multi-batch

**Step 3: Update ReviewService tests for ConsoleLogger**

In `src/review/review.service.spec.ts`, add ConsoleLogger to providers:

```typescript
import { ConsoleLogger } from '@nestjs/common';

// In providers array:
providers: [
  ReviewService,
  ConsoleLogger,
  { provide: CodeReaderService, useValue: mockCodeReader },
  { provide: CouncilService, useValue: mockCouncil },
  { provide: DecisionMakerService, useValue: mockDecisionMaker },
  { provide: AcpService, useValue: mockAcpService },
],
```

Update the multi-batch test to verify `decide` receives file summary, not full code:

```typescript
it('should review multi-batch codebase with file summary for decision maker', async () => {
  mockCodeReader.readCodebase.mockResolvedValue([
    [{ path: 'batch1.ts', content: 'a' }],
    [{ path: 'batch2.ts', content: 'b' }],
    [{ path: 'batch3.ts', content: 'c' }],
  ]);
  const result = await service.reviewCodebase('/tmp/project');
  expect(result.status).toBe('completed');
  expect(mockCouncil.dispatchReviews).toHaveBeenCalledTimes(3);
  expect(result.individualReviews.length).toBe(6);
  expect(mockDecisionMaker.decide).toHaveBeenCalledTimes(1);

  // Decision maker receives file summary (not full code) in multi-batch mode
  const decideCalls = mockDecisionMaker.decide.mock.calls[0];
  expect(decideCalls[0]).toContain('batch1.ts');
  expect(decideCalls[0]).toContain('lines');
  expect(decideCalls[2]).toBe(true); // isSummaryMode
});
```

Also update the `stopAll` assertion for multi-batch (called after each batch + finally):

```typescript
// In multi-batch test:
// stopAll called 3 times (once per batch) + 1 in finally = 4 total
expect(mockAcpService.stopAll).toHaveBeenCalled();
```

**Step 4: Run tests**

Run: `npx vitest run src/review/review.service.spec.ts --reporter=verbose`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/review/review.service.ts src/review/review.service.spec.ts
git commit -m "refactor: remove console.log from ReviewService, fix multi-batch resource cleanup"
```

---

### Task 6: DecisionMaker — JSON parsing & summary mode (B5, A2, B13)

**Files:**
- Modify: `src/review/decision-maker.service.ts`
- Modify: `src/review/decision-maker.service.spec.ts`

**Step 1: Write failing test for JSON with surrounding text**

Add to `src/review/decision-maker.service.spec.ts`:

```typescript
it('should parse JSON embedded in text with markdown fences', async () => {
  const jsonObj = {
    overallAssessment: 'Good code.',
    decisions: [],
    additionalFindings: [],
  };
  mockAcpService.sendPrompt.mockResolvedValue(
    'Here is my analysis:\n```json\n' + JSON.stringify(jsonObj) + '\n```\nEnd.'
  );
  const decision = await service.decide(
    'const x = 1;',
    [{ reviewer: 'Test', review: 'OK' }],
  );
  expect(decision.overallAssessment).toBe('Good code.');
});

it('should use summary mode prompt when isSummaryMode is true', async () => {
  await service.decide(
    'file1.ts (10 lines)\nfile2.ts (20 lines)',
    [{ reviewer: 'Test', review: 'OK' }],
    true,
  );
  const sentPrompt = mockAcpService.sendPrompt.mock.calls[0][1];
  expect(sentPrompt).toContain('file summary');
  expect(sentPrompt).not.toContain('Review the code yourself');
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/review/decision-maker.service.spec.ts --reporter=verbose`
Expected: 2 new tests FAIL

**Step 3: Update DecisionMakerService**

Replace `src/review/decision-maker.service.ts`:

```typescript
import { Injectable, ConsoleLogger, Inject } from '@nestjs/common';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { IndividualReview, ReviewDecision } from './review.types.js';

const MAX_CODE_LENGTH = 60_000;
const MAX_REVIEWS_LENGTH = 30_000;

@Injectable()
export class DecisionMakerService {
  constructor(
    private readonly logger: ConsoleLogger,
    @Inject(AcpService) private readonly acpService: AcpService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.logger.setContext(DecisionMakerService.name);
  }

  async decide(
    code: string,
    reviews: IndividualReview[],
    isSummaryMode = false,
  ): Promise<ReviewDecision> {
    const config = this.configService.getConfig();
    const dmConfig = config.decisionMaker;
    const lang = config.review.language ?? 'zh-tw';

    this.logger.log(`Decision maker ${dmConfig.name} reviewing code and ${reviews.length} reviewer opinions...`);

    const handle = await this.acpService.createClient(dmConfig);

    const reviewsText = this.buildReviewsSection(reviews);
    const codeSection = isSummaryMode
      ? this.buildSummarySection(code)
      : this.buildCodeSection(code);

    const responsibilities = isSummaryMode
      ? `## Your responsibilities:
1. **Read the file summary** — understand the scope of the codebase being reviewed
2. **Read other reviewers' opinions** — consider their findings carefully
3. **Make final decisions** — agree or disagree with each suggestion based on your judgement
Note: The codebase was too large to include in full. You are given a file summary instead. Focus on evaluating the reviewers' opinions rather than reviewing code directly.`
      : `## Your responsibilities:
1. **Review the code yourself** — form your own independent opinion based on the code provided
2. **Read other reviewers' opinions** — consider their findings
3. **Make final decisions** — agree or disagree with each suggestion based on your own judgement`;

    const prompt = `You are a senior engineering lead and the final decision maker in a code review council.
You MUST reply entirely in ${lang}. All text content must be written in ${lang}.
Respond with ONLY a JSON object. No other text.

${responsibilities}

${codeSection}

## Other reviewers' opinions:
${reviewsText}

## Output format:
Output ONLY a JSON object (no markdown fences, no explanation before or after):
{
  "overallAssessment": "Your own overall assessment of the code quality in 2-3 paragraphs (in ${lang})",
  "decisions": [
    {
      "severity": "high|medium|low",
      "category": "security|performance|readability|code-quality|best-practices",
      "description": "What the issue is (in ${lang})",
      "file": "filename if applicable",
      "line": null,
      "raisedBy": ["reviewer names who flagged this"],
      "verdict": "accepted|rejected|modified",
      "reasoning": "Why you agree, disagree, or modified this suggestion (in ${lang})",
      "suggestion": "Final recommended action (in ${lang})"
    }
  ],
  "additionalFindings": [
    {
      "severity": "high|medium|low",
      "category": "...",
      "description": "Issues YOU found that reviewers missed (in ${lang})",
      "file": "filename if applicable",
      "suggestion": "How to fix it (in ${lang})"
    }
  ]
}

Rules:
- Focus on the TOP 15 most important suggestions only. Skip trivial or low-impact items.
- Be critical: reject suggestions that are subjective, over-engineered, or not actionable
- Add at most 3 additional findings if reviewers missed important issues
- verdict "accepted" = you agree with the reviewer's suggestion
- verdict "rejected" = you disagree and explain why
- verdict "modified" = you partially agree but adjust the recommendation
- Keep reasoning and suggestion fields concise (1-2 sentences each)
- Output ONLY the JSON object, nothing else`;

    this.logger.log(`Sending prompt to decision maker (${prompt.length} chars)`);
    const response = await this.acpService.sendPrompt(handle, prompt, 300_000);

    return this.parseResponse(response, dmConfig.name);
  }

  private parseResponse(response: string, dmName: string): ReviewDecision {
    // Strategy 1: try direct parse
    try {
      const parsed = JSON.parse(response.trim());
      return this.toDecision(parsed, dmName);
    } catch {
      // continue to strategy 2
    }

    // Strategy 2: extract JSON from markdown fences or surrounding text
    const stripped = response
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    try {
      const parsed = JSON.parse(stripped);
      return this.toDecision(parsed, dmName);
    } catch {
      // continue to strategy 3
    }

    // Strategy 3: non-greedy regex to find first complete JSON object
    const jsonMatch = stripped.match(/\{[\s\S]*?\}(?=\s*$)/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.toDecision(parsed, dmName);
      } catch {
        // fall through
      }
    }

    this.logger.warn('Failed to parse decision maker response as JSON, returning raw text');
    return {
      reviewer: `${dmName} (Decision Maker)`,
      overallAssessment: response,
      decisions: [],
      additionalFindings: [],
    };
  }

  private toDecision(parsed: any, dmName: string): ReviewDecision {
    return {
      reviewer: `${dmName} (Decision Maker)`,
      overallAssessment: parsed.overallAssessment ?? '',
      decisions: parsed.decisions ?? [],
      additionalFindings: parsed.additionalFindings ?? [],
    };
  }

  private buildReviewsSection(reviews: IndividualReview[]): string {
    const full = reviews
      .map((r) => `=== ${r.reviewer} ===\n${r.review}`)
      .join('\n\n');

    if (full.length <= MAX_REVIEWS_LENGTH) {
      return full;
    }

    this.logger.log(`Reviews too large (${full.length} chars), truncating each review proportionally`);

    const perReview = Math.floor(MAX_REVIEWS_LENGTH / reviews.length) - 50;
    return reviews
      .map((r) => {
        const text = r.review.length > perReview
          ? r.review.slice(0, perReview) + '\n...(truncated)'
          : r.review;
        return `=== ${r.reviewer} ===\n${text}`;
      })
      .join('\n\n');
  }

  private buildCodeSection(code: string): string {
    if (code.length <= MAX_CODE_LENGTH) {
      return `## Code to review:\n\`\`\`\n${code}\n\`\`\``;
    }

    this.logger.log(`Code too large (${code.length} chars), truncating to ${MAX_CODE_LENGTH}`);
    return `## Code to review (truncated from ${code.length} to ${MAX_CODE_LENGTH} chars):\n\`\`\`\n${code.slice(0, MAX_CODE_LENGTH)}\n...(truncated)\n\`\`\``;
  }

  private buildSummarySection(fileSummary: string): string {
    return `## Files reviewed (file summary — full code was split into batches for individual reviewers):\n\`\`\`\n${fileSummary}\n\`\`\``;
  }
}
```

Key changes:
- `new Logger()` → injected `ConsoleLogger` (B13)
- New `isSummaryMode` parameter (A2) — multi-batch uses file summary, not full code
- `parseResponse()` uses 3-strategy approach (B5): direct parse → strip fences → regex fallback
- Extracted `toDecision()` helper to reduce duplication

**Step 4: Update DecisionMakerService tests for ConsoleLogger**

In `src/review/decision-maker.service.spec.ts`, add ConsoleLogger:

```typescript
import { ConsoleLogger } from '@nestjs/common';

// In providers:
providers: [
  DecisionMakerService,
  ConsoleLogger,
  { provide: AcpService, useValue: mockAcpService },
  { provide: ConfigService, useValue: mockConfigService },
],
```

**Step 5: Run tests**

Run: `npx vitest run src/review/decision-maker.service.spec.ts --reporter=verbose`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/review/decision-maker.service.ts src/review/decision-maker.service.spec.ts
git commit -m "refactor: improve JSON parsing, add summary mode for multi-batch"
```

---

### Task 7: CLI commands — output formatting, validation, process.exit (B8, C11, C12)

**Files:**
- Modify: `src/cli/codebase.command.ts`
- Modify: `src/cli/diff.command.ts`
- Modify: `src/cli/file.command.ts`

**Step 1: Update CodebaseCommand with output formatting and validation**

Replace `src/cli/codebase.command.ts`:

```typescript
import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject } from '@nestjs/common';
import { ReviewService } from '../review/review.service.js';
import { ConfigService } from '../config/config.service.js';
import { ReviewResult } from '../review/review.types.js';

@Command({ name: 'codebase', description: 'Review entire codebase' })
export class CodebaseCommand extends CommandRunner {
  constructor(
    @Inject(ReviewService) private readonly reviewService: ReviewService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(_params: string[], options: Record<string, any>): Promise<void> {
    await this.configService.loadConfig(options.config);

    const directory = options.dir ?? process.cwd();
    const extensions = options.extensions?.split(',').map((e: string) => e.trim()).filter(Boolean) ?? undefined;
    const parsedBatchSize = options.batchSize ? parseInt(options.batchSize, 10) : undefined;
    const maxBatchSize = parsedBatchSize !== undefined && isNaN(parsedBatchSize) ? undefined : parsedBatchSize;
    const checks = options.checks?.split(',').filter(Boolean) ?? [];
    const extra = options.extra;

    console.log('\n=== Code Review Council ===\n');
    console.log(`Directory: ${directory}`);
    if (extensions) console.log(`Extensions: ${extensions.join(', ')}`);
    if (maxBatchSize) console.log(`Batch size: ${maxBatchSize}`);
    console.log('Reviewing...\n');

    const result = await this.reviewService.reviewCodebase(
      directory,
      { extensions, maxBatchSize },
      checks,
      extra,
    );

    this.printResult(result);
  }

  private printResult(result: ReviewResult): void {
    console.log('\n=== Individual Reviews ===\n');
    for (const r of result.individualReviews) {
      console.log(`\n--- ${r.reviewer} ---`);
      console.log(r.review);
      console.log();
    }

    if (result.decision) {
      this.printDecision(result.decision);
    }
  }

  private printDecision(decision: any): void {
    console.log('\n=== Final Decision (by ' + decision.reviewer + ') ===\n');
    console.log(decision.overallAssessment);
    if (decision.decisions?.length > 0) {
      console.log('\nDecisions:');
      for (const d of decision.decisions) {
        const verdict = d.verdict === 'accepted' ? '\u2705' : d.verdict === 'rejected' ? '\u274C' : '\u270F\uFE0F';
        console.log(`  ${verdict} [${d.severity}] ${d.category}: ${d.description}`);
        if (d.reasoning) console.log(`    Reasoning: ${d.reasoning}`);
        if (d.suggestion) console.log(`    Action: ${d.suggestion}`);
        if (d.raisedBy?.length > 0) console.log(`    Raised by: ${d.raisedBy.join(', ')}`);
      }
    }
    if (decision.additionalFindings?.length > 0) {
      console.log('\nAdditional Findings (by Decision Maker):');
      for (const f of decision.additionalFindings) {
        console.log(`  [${f.severity}] ${f.category}: ${f.description}`);
        if (f.suggestion) console.log(`    Action: ${f.suggestion}`);
      }
    }
  }

  @Option({ flags: '--dir <path>', description: 'Directory to review (default: cwd)' })
  parseDir(val: string) { return val; }

  @Option({ flags: '--extensions <list>', description: 'Comma-separated file extensions (e.g. ts,js,py)' })
  parseExtensions(val: string) { return val; }

  @Option({ flags: '--batch-size <chars>', description: 'Max characters per batch (default: 100000)' })
  parseBatchSize(val: string) { return val; }

  @Option({ flags: '--checks <list>', description: 'Comma-separated check categories' })
  parseChecks(val: string) { return val; }

  @Option({ flags: '--extra <instructions>', description: 'Extra review instructions' })
  parseExtra(val: string) { return val; }

  @Option({ flags: '--config <path>', description: 'Config file path' })
  parseConfig(val: string) { return val; }
}
```

Key changes:
- Added `printResult()` and `printDecision()` — output formatting now lives in CLI layer (B8)
- `checks` uses `.filter(Boolean)` (C12)
- `batchSize` uses `isNaN` check (C12)

**Step 2: Update DiffCommand with output formatting and validation**

Replace `src/cli/diff.command.ts`:

```typescript
import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject } from '@nestjs/common';
import { ReviewService } from '../review/review.service.js';
import { ConfigService } from '../config/config.service.js';
import { ReviewResult } from '../review/review.types.js';

@Command({ name: 'diff', description: 'Review git diff' })
export class DiffCommand extends CommandRunner {
  constructor(
    @Inject(ReviewService) private readonly reviewService: ReviewService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(params: string[], options: Record<string, any>): Promise<void> {
    await this.configService.loadConfig(options.config);

    const repoPath = options.repo ?? process.cwd();
    const baseBranch = options.base ?? 'main';
    const checks = options.checks?.split(',').filter(Boolean) ?? [];
    const extra = options.extra;

    console.log('\n=== Code Review Council ===\n');
    console.log(`Repo: ${repoPath}`);
    console.log(`Base: ${baseBranch}`);
    console.log('Reviewing...\n');

    const result = await this.reviewService.reviewDiff(repoPath, baseBranch, checks, extra);

    this.printResult(result);
  }

  private printResult(result: ReviewResult): void {
    console.log('\n=== Individual Reviews ===\n');
    for (const r of result.individualReviews) {
      console.log(`\n--- ${r.reviewer} ---`);
      console.log(r.review);
      console.log();
    }

    if (result.decision) {
      console.log('\n=== Final Decision (by ' + result.decision.reviewer + ') ===\n');
      console.log(result.decision.overallAssessment);
      if (result.decision.decisions?.length > 0) {
        console.log('\nDecisions:');
        for (const d of result.decision.decisions) {
          const verdict = d.verdict === 'accepted' ? '\u2705' : d.verdict === 'rejected' ? '\u274C' : '\u270F\uFE0F';
          console.log(`  ${verdict} [${d.severity}] ${d.category}: ${d.description}`);
          if (d.reasoning) console.log(`    Reasoning: ${d.reasoning}`);
          if (d.suggestion) console.log(`    Action: ${d.suggestion}`);
          if (d.raisedBy?.length > 0) console.log(`    Raised by: ${d.raisedBy.join(', ')}`);
        }
      }
      if (result.decision.additionalFindings?.length > 0) {
        console.log('\nAdditional Findings (by Decision Maker):');
        for (const f of result.decision.additionalFindings) {
          console.log(`  [${f.severity}] ${f.category}: ${f.description}`);
          if (f.suggestion) console.log(`    Action: ${f.suggestion}`);
        }
      }
    }
  }

  @Option({ flags: '--repo <path>', description: 'Repository path' })
  parseRepo(val: string) { return val; }

  @Option({ flags: '--base <branch>', description: 'Base branch (default: main)' })
  parseBase(val: string) { return val; }

  @Option({ flags: '--checks <list>', description: 'Comma-separated check categories' })
  parseChecks(val: string) { return val; }

  @Option({ flags: '--extra <instructions>', description: 'Extra review instructions' })
  parseExtra(val: string) { return val; }

  @Option({ flags: '--config <path>', description: 'Config file path' })
  parseConfig(val: string) { return val; }
}
```

**Step 3: Update FileCommand — remove process.exit, add output formatting**

Replace `src/cli/file.command.ts`:

```typescript
import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject } from '@nestjs/common';
import { ReviewService } from '../review/review.service.js';
import { ConfigService } from '../config/config.service.js';
import { ReviewResult } from '../review/review.types.js';

@Command({ name: 'file', description: 'Review specific files' })
export class FileCommand extends CommandRunner {
  constructor(
    @Inject(ReviewService) private readonly reviewService: ReviewService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(params: string[], options: Record<string, any>): Promise<void> {
    if (params.length === 0) {
      throw new Error('Please provide at least one file path.');
    }

    await this.configService.loadConfig(options.config);

    const checks = options.checks?.split(',').filter(Boolean) ?? [];
    const extra = options.extra;

    console.log('\n=== Code Review Council ===\n');
    console.log(`Files: ${params.join(', ')}`);
    console.log('Reviewing...\n');

    const result = await this.reviewService.reviewFiles(params, checks, extra);

    this.printResult(result);
  }

  private printResult(result: ReviewResult): void {
    console.log('\n=== Individual Reviews ===\n');
    for (const r of result.individualReviews) {
      console.log(`\n--- ${r.reviewer} ---`);
      console.log(r.review);
      console.log();
    }

    if (result.decision) {
      console.log('\n=== Final Decision (by ' + result.decision.reviewer + ') ===\n');
      console.log(result.decision.overallAssessment);
      if (result.decision.decisions?.length > 0) {
        console.log('\nDecisions:');
        for (const d of result.decision.decisions) {
          const verdict = d.verdict === 'accepted' ? '\u2705' : d.verdict === 'rejected' ? '\u274C' : '\u270F\uFE0F';
          console.log(`  ${verdict} [${d.severity}] ${d.category}: ${d.description}`);
          if (d.reasoning) console.log(`    Reasoning: ${d.reasoning}`);
          if (d.suggestion) console.log(`    Action: ${d.suggestion}`);
          if (d.raisedBy?.length > 0) console.log(`    Raised by: ${d.raisedBy.join(', ')}`);
        }
      }
      if (result.decision.additionalFindings?.length > 0) {
        console.log('\nAdditional Findings (by Decision Maker):');
        for (const f of result.decision.additionalFindings) {
          console.log(`  [${f.severity}] ${f.category}: ${f.description}`);
          if (f.suggestion) console.log(`    Action: ${f.suggestion}`);
        }
      }
    }
  }

  @Option({ flags: '--checks <list>', description: 'Comma-separated check categories' })
  parseChecks(val: string) { return val; }

  @Option({ flags: '--extra <instructions>', description: 'Extra review instructions' })
  parseExtra(val: string) { return val; }

  @Option({ flags: '--config <path>', description: 'Config file path' })
  parseConfig(val: string) { return val; }
}
```

Key changes:
- `process.exit(1)` → `throw new Error(...)` (C11)
- `checks` uses `.filter(Boolean)` (C12)
- Added `printResult()` for output formatting (B8)

**Step 4: Run all tests**

Run: `npx vitest run --reporter=verbose`
Expected: All tests PASS (except 1 pre-existing environment-dependent diff test)

**Step 5: Build to verify compilation**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 6: Commit**

```bash
git add src/cli/codebase.command.ts src/cli/diff.command.ts src/cli/file.command.ts
git commit -m "refactor: move output formatting to CLI layer, fix input validation"
```

---

## Final Verification

After all 7 tasks are complete:

1. Run full test suite: `npx vitest run --reporter=verbose`
2. Build: `npm run build`
3. Smoke test: `node dist/cli.js codebase --dir ./src --extensions ts`

All 15 issues should be resolved:
- A1 ✅ Multi-batch client cleanup (Task 5)
- A2 ✅ File summary for DecisionMaker (Tasks 5, 6)
- A3 ✅ Sensitive file exclusion (Task 3)
- B4 ✅ setMaxListeners in bootstrap (Task 1)
- B5 ✅ Robust JSON parsing (Task 6)
- B6 ✅ Config schema validation (Task 2)
- B7 ✅ ACP local interfaces (Task 1)
- B8 ✅ Output in CLI layer only (Tasks 4, 5, 7)
- B9 ✅ Session destroy logging (Task 1)
- B10 ✅ Large file protection (Task 3)
- B13 ✅ ConsoleLogger injection (Tasks 1, 3, 4, 5, 6)
- C11 ✅ No process.exit (Task 7)
- C12 ✅ CLI option validation (Task 7)
- C14 ✅ Timeout format (Task 1)
- C15 ✅ Promise.allSettled (Task 4)
