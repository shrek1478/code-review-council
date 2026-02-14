# Code Review Council Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a NestJS application that orchestrates multiple AI models via ACP to perform parallel code reviews, with Claude Code as the final summarizer.

**Architecture:** A modular NestJS app with ConfigModule (reads reviewer config), AcpModule (CopilotClient factory), ReviewModule (orchestrates parallel reviews + summarization), and CliModule (nest-commander CLI). REST API and CLI both supported.

**Tech Stack:** NestJS 11, TypeScript, nest-commander, @github/copilot-sdk, simple-git, vitest

---

### Task 1: Scaffold NestJS Project

**Files:**
- Create: `code-review-council/` (new project directory)

**Step 1: Create NestJS project**

```bash
cd /Users/he6463/Hepiuscare/sample/copilot-sdk-acp
npx @nestjs/cli new code-review-council --skip-git --package-manager npm --strict
```

Select npm as package manager when prompted.

**Step 2: Install dependencies**

```bash
cd /Users/he6463/Hepiuscare/sample/copilot-sdk-acp/code-review-council
npm install @github/copilot-sdk simple-git nest-commander uuid
npm install -D @types/uuid vitest
```

Note: `@github/copilot-sdk` is installed from the local path `../copilot-sdk/nodejs`.

**Step 3: Update package.json**

Add to `package.json`:
- `"type": "module"` for ESM support
- `"bin"` entry for CLI
- scripts for CLI entry point

```json
{
  "type": "module",
  "bin": {
    "code-review-council": "./dist/cli.js"
  },
  "scripts": {
    "start:cli": "node dist/cli.js"
  }
}
```

**Step 4: Update tsconfig.json for ESM**

Ensure `tsconfig.json` has:
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "esModuleInterop": true
  }
}
```

**Step 5: Verify project builds**

```bash
npm run build
```

Expected: Build succeeds with no errors.

**Step 6: Commit**

```bash
git add .
git commit -m "feat: scaffold NestJS project for code-review-council"
```

---

### Task 2: ConfigModule + ConfigService

**Files:**
- Create: `src/config/config.module.ts`
- Create: `src/config/config.service.ts`
- Create: `src/config/config.types.ts`
- Create: `review-council.config.json`
- Test: `src/config/config.service.spec.ts`

**Step 1: Define config types**

Create `src/config/config.types.ts`:
```typescript
export interface ReviewerConfig {
  name: string;
  cliPath: string;
  cliArgs: string[];
}

export interface ReviewConfig {
  defaultChecks: string[];
  language: string;
}

export interface CouncilConfig {
  reviewers: ReviewerConfig[];
  summarizer: ReviewerConfig;
  review: ReviewConfig;
}
```

**Step 2: Create default config file**

Create `review-council.config.json`:
```json
{
  "reviewers": [
    { "name": "Gemini", "cliPath": "gemini", "cliArgs": ["--experimental-acp"] },
    { "name": "Claude", "cliPath": "claude-code-acp", "cliArgs": [] },
    { "name": "Codex", "cliPath": "codex-acp", "cliArgs": [] }
  ],
  "summarizer": {
    "name": "Claude",
    "cliPath": "claude-code-acp",
    "cliArgs": []
  },
  "review": {
    "defaultChecks": ["code-quality", "security", "performance", "readability", "best-practices"],
    "language": "zh-tw"
  }
}
```

**Step 3: Write failing test for ConfigService**

Create `src/config/config.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from './config.service.js';
import { describe, it, expect, beforeEach } from 'vitest';

describe('ConfigService', () => {
  let service: ConfigService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ConfigService],
    }).compile();
    service = module.get(ConfigService);
  });

  it('should load config from file', async () => {
    const config = await service.loadConfig();
    expect(config.reviewers).toBeDefined();
    expect(config.reviewers.length).toBeGreaterThan(0);
    expect(config.summarizer).toBeDefined();
    expect(config.review.defaultChecks).toBeDefined();
  });

  it('should load config from custom path', async () => {
    const config = await service.loadConfig('./review-council.config.json');
    expect(config.reviewers[0].name).toBe('Gemini');
  });
});
```

**Step 4: Run test to verify it fails**

```bash
npx vitest run src/config/config.service.spec.ts
```

Expected: FAIL (ConfigService not found)

**Step 5: Implement ConfigService**

Create `src/config/config.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CouncilConfig } from './config.types.js';

@Injectable()
export class ConfigService {
  private config: CouncilConfig | null = null;

  async loadConfig(configPath?: string): Promise<CouncilConfig> {
    const filePath = resolve(configPath ?? 'review-council.config.json');
    const content = await readFile(filePath, 'utf-8');
    this.config = JSON.parse(content) as CouncilConfig;
    return this.config;
  }

  getConfig(): CouncilConfig {
    if (!this.config) {
      throw new Error('Config not loaded. Call loadConfig() first.');
    }
    return this.config;
  }
}
```

**Step 6: Create ConfigModule**

Create `src/config/config.module.ts`:
```typescript
import { Module, Global } from '@nestjs/common';
import { ConfigService } from './config.service.js';

@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class CouncilConfigModule {}
```

**Step 7: Run tests to verify they pass**

```bash
npx vitest run src/config/config.service.spec.ts
```

Expected: PASS

**Step 8: Commit**

```bash
git add src/config/ review-council.config.json
git commit -m "feat: add ConfigModule with config loading and types"
```

---

### Task 3: AcpModule + AcpService

**Files:**
- Create: `src/acp/acp.module.ts`
- Create: `src/acp/acp.service.ts`
- Test: `src/acp/acp.service.spec.ts`

**Step 1: Write failing test for AcpService**

Create `src/acp/acp.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { AcpService } from './acp.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @github/copilot-sdk
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue({
      on: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}));

describe('AcpService', () => {
  let service: AcpService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AcpService],
    }).compile();
    service = module.get(AcpService);
  });

  it('should create a client for a reviewer config', async () => {
    const client = await service.createClient({
      name: 'TestReviewer',
      cliPath: 'test-cli',
      cliArgs: ['--test'],
    });
    expect(client).toBeDefined();
  });

  it('should send prompt and return response', async () => {
    const client = await service.createClient({
      name: 'TestReviewer',
      cliPath: 'test-cli',
      cliArgs: [],
    });
    // sendPrompt is tested via mock
    expect(client).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/acp/acp.service.spec.ts
```

Expected: FAIL (AcpService not found)

**Step 3: Implement AcpService**

Create `src/acp/acp.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { CopilotClient } from '@github/copilot-sdk';
import { ReviewerConfig } from '../config/config.types.js';

export interface AcpClientHandle {
  name: string;
  client: CopilotClient;
}

@Injectable()
export class AcpService {
  private readonly logger = new Logger(AcpService.name);
  private clients: AcpClientHandle[] = [];

  async createClient(config: ReviewerConfig): Promise<AcpClientHandle> {
    this.logger.log(`Creating ACP client: ${config.name} (${config.cliPath})`);
    const client = new CopilotClient({
      cliPath: config.cliPath,
      cliArgs: config.cliArgs,
      protocol: 'acp',
    });
    await client.start();
    const handle = { name: config.name, client };
    this.clients.push(handle);
    return handle;
  }

  async sendPrompt(handle: AcpClientHandle, prompt: string): Promise<string> {
    const session = await handle.client.createSession();
    try {
      const result = await new Promise<string>((resolve, reject) => {
        let responseContent = '';
        session.on((event: any) => {
          if (event.type === 'assistant.message') {
            responseContent = event.data.content || '';
          } else if (event.type === 'session.idle') {
            resolve(responseContent);
          } else if (event.type === 'error') {
            reject(new Error(event.data?.message || 'ACP error'));
          }
        });
        session.send({ prompt }).catch(reject);
      });
      return result;
    } finally {
      try { await session.destroy(); } catch {}
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

**Step 4: Create AcpModule**

Create `src/acp/acp.module.ts`:
```typescript
import { Module, Global } from '@nestjs/common';
import { AcpService } from './acp.service.js';

@Global()
@Module({
  providers: [AcpService],
  exports: [AcpService],
})
export class AcpModule {}
```

**Step 5: Run tests to verify they pass**

```bash
npx vitest run src/acp/acp.service.spec.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/acp/
git commit -m "feat: add AcpModule with CopilotClient factory and prompt handling"
```

---

### Task 4: CodeReaderService

**Files:**
- Create: `src/review/code-reader.service.ts`
- Test: `src/review/code-reader.service.spec.ts`

**Step 1: Write failing test**

Create `src/review/code-reader.service.spec.ts`:
```typescript
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
    // Use this project's own repo for testing
    const diff = await service.readGitDiff(process.cwd(), 'HEAD~1');
    expect(typeof diff).toBe('string');
  });

  it('should read file contents', async () => {
    const content = await service.readFiles([__filename]);
    expect(content.length).toBe(1);
    expect(content[0].content).toContain('CodeReaderService');
  });

  it('should throw on invalid repo path', async () => {
    await expect(
      service.readGitDiff('/nonexistent/path', 'main')
    ).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/review/code-reader.service.spec.ts
```

Expected: FAIL (CodeReaderService not found)

**Step 3: Implement CodeReaderService**

Create `src/review/code-reader.service.ts`:
```typescript
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

  async readGitDiff(repoPath: string, baseBranch: string = 'main'): Promise<string> {
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
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/review/code-reader.service.spec.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/review/code-reader.service.ts src/review/code-reader.service.spec.ts
git commit -m "feat: add CodeReaderService for git diff and file reading"
```

---

### Task 5: CouncilService (Parallel Review)

**Files:**
- Create: `src/review/council.service.ts`
- Create: `src/review/review.types.ts`
- Test: `src/review/council.service.spec.ts`

**Step 1: Define review types**

Create `src/review/review.types.ts`:
```typescript
export interface IndividualReview {
  reviewer: string;
  review: string;
}

export interface ReviewIssue {
  severity: 'high' | 'medium' | 'low';
  category: string;
  description: string;
  file?: string;
  line?: number;
  agreedBy: string[];
  suggestion: string;
}

export interface ReviewSummary {
  reviewer: string;
  aggregatedReview: string;
  issues: ReviewIssue[];
}

export interface ReviewResult {
  id: string;
  status: 'pending' | 'reviewing' | 'completed' | 'failed';
  individualReviews: IndividualReview[];
  summary?: ReviewSummary;
}

export interface ReviewRequest {
  code: string;
  checks: string[];
  extraInstructions?: string;
  language?: string;
}
```

**Step 2: Write failing test**

Create `src/review/council.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { CouncilService } from './council.service.js';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('CouncilService', () => {
  let service: CouncilService;
  const mockAcpService = {
    createClient: vi.fn().mockResolvedValue({ name: 'MockReviewer', client: {} }),
    sendPrompt: vi.fn().mockResolvedValue('No issues found.'),
    stopAll: vi.fn().mockResolvedValue(undefined),
  };
  const mockConfigService = {
    getConfig: vi.fn().mockReturnValue({
      reviewers: [
        { name: 'Gemini', cliPath: 'gemini', cliArgs: ['--experimental-acp'] },
        { name: 'Claude', cliPath: 'claude-code-acp', cliArgs: [] },
      ],
      review: { defaultChecks: ['code-quality'], language: 'zh-tw' },
    }),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CouncilService,
        { provide: AcpService, useValue: mockAcpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get(CouncilService);
    vi.clearAllMocks();
  });

  it('should dispatch reviews to all configured reviewers in parallel', async () => {
    const reviews = await service.dispatchReviews({
      code: 'const x = 1;',
      checks: ['code-quality'],
    });
    expect(reviews.length).toBe(2);
    expect(mockAcpService.createClient).toHaveBeenCalledTimes(2);
    expect(mockAcpService.sendPrompt).toHaveBeenCalledTimes(2);
  });

  it('should handle reviewer failure gracefully', async () => {
    mockAcpService.sendPrompt
      .mockResolvedValueOnce('OK')
      .mockRejectedValueOnce(new Error('timeout'));
    const reviews = await service.dispatchReviews({
      code: 'const x = 1;',
      checks: ['code-quality'],
    });
    expect(reviews.length).toBe(2);
    expect(reviews[1].review).toContain('error');
  });
});
```

**Step 3: Run test to verify it fails**

```bash
npx vitest run src/review/council.service.spec.ts
```

Expected: FAIL (CouncilService not found)

**Step 4: Implement CouncilService**

Create `src/review/council.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { IndividualReview, ReviewRequest } from './review.types.js';

@Injectable()
export class CouncilService {
  private readonly logger = new Logger(CouncilService.name);

  constructor(
    private readonly acpService: AcpService,
    private readonly configService: ConfigService,
  ) {}

  async dispatchReviews(request: ReviewRequest): Promise<IndividualReview[]> {
    const config = this.configService.getConfig();
    const reviewers = config.reviewers;

    this.logger.log(`Dispatching reviews to ${reviewers.length} reviewers...`);

    const prompt = this.buildReviewPrompt(request);

    const reviewPromises = reviewers.map(async (reviewerConfig) => {
      try {
        const handle = await this.acpService.createClient(reviewerConfig);
        const review = await this.acpService.sendPrompt(handle, prompt);
        return { reviewer: reviewerConfig.name, review };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Reviewer ${reviewerConfig.name} failed: ${msg}`);
        return { reviewer: reviewerConfig.name, review: `[error] ${msg}` };
      }
    });

    return Promise.all(reviewPromises);
  }

  private buildReviewPrompt(request: ReviewRequest): string {
    const config = this.configService.getConfig();
    const lang = request.language ?? config.review.language ?? 'zh-tw';
    const checks = request.checks.length > 0 ? request.checks : config.review.defaultChecks;

    let prompt = `You are a senior code reviewer. Please review the following code.
Reply in ${lang}.

Check for: ${checks.join(', ')}

For each issue found, provide:
- Severity (high/medium/low)
- Category
- Description
- File and line number if applicable
- Suggested fix

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

**Step 5: Run tests to verify they pass**

```bash
npx vitest run src/review/council.service.spec.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/review/review.types.ts src/review/council.service.ts src/review/council.service.spec.ts
git commit -m "feat: add CouncilService for parallel review dispatch"
```

---

### Task 6: SummarizerService

**Files:**
- Create: `src/review/summarizer.service.ts`
- Test: `src/review/summarizer.service.spec.ts`

**Step 1: Write failing test**

Create `src/review/summarizer.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { SummarizerService } from './summarizer.service.js';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('SummarizerService', () => {
  let service: SummarizerService;
  const mockAcpService = {
    createClient: vi.fn().mockResolvedValue({ name: 'Summarizer', client: {} }),
    sendPrompt: vi.fn().mockResolvedValue(JSON.stringify({
      aggregatedReview: 'Code looks good overall.',
      issues: [
        {
          severity: 'medium',
          category: 'readability',
          description: 'Variable naming could be improved',
          agreedBy: ['Gemini', 'Claude'],
          suggestion: 'Use descriptive names',
        },
      ],
    })),
    stopAll: vi.fn().mockResolvedValue(undefined),
  };
  const mockConfigService = {
    getConfig: vi.fn().mockReturnValue({
      summarizer: { name: 'Claude', cliPath: 'claude-code-acp', cliArgs: [] },
      review: { language: 'zh-tw' },
    }),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SummarizerService,
        { provide: AcpService, useValue: mockAcpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get(SummarizerService);
    vi.clearAllMocks();
  });

  it('should summarize individual reviews', async () => {
    const summary = await service.summarize([
      { reviewer: 'Gemini', review: 'Variable naming could be improved.' },
      { reviewer: 'Claude', review: 'Consider renaming variables for clarity.' },
    ]);
    expect(summary.reviewer).toContain('Claude');
    expect(summary.aggregatedReview).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/review/summarizer.service.spec.ts
```

Expected: FAIL (SummarizerService not found)

**Step 3: Implement SummarizerService**

Create `src/review/summarizer.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { IndividualReview, ReviewSummary } from './review.types.js';

@Injectable()
export class SummarizerService {
  private readonly logger = new Logger(SummarizerService.name);

  constructor(
    private readonly acpService: AcpService,
    private readonly configService: ConfigService,
  ) {}

  async summarize(reviews: IndividualReview[]): Promise<ReviewSummary> {
    const config = this.configService.getConfig();
    const summarizerConfig = config.summarizer;
    const lang = config.review.language ?? 'zh-tw';

    this.logger.log(`Summarizing ${reviews.length} reviews with ${summarizerConfig.name}...`);

    const handle = await this.acpService.createClient(summarizerConfig);

    const reviewsText = reviews
      .map((r) => `=== ${r.reviewer} ===\n${r.review}`)
      .join('\n\n');

    const prompt = `You are a senior engineering lead. Multiple AI code reviewers have reviewed the same code.
Your job is to aggregate their feedback, judge the reasonableness of each suggestion, and produce a final summary.
Reply in ${lang}.

Individual reviews:
${reviewsText}

Please output a JSON object with this structure:
{
  "aggregatedReview": "Overall assessment in 2-3 paragraphs",
  "issues": [
    {
      "severity": "high|medium|low",
      "category": "security|performance|readability|code-quality|best-practices",
      "description": "What the issue is",
      "file": "filename if mentioned",
      "line": null,
      "agreedBy": ["reviewer names who flagged this"],
      "suggestion": "How to fix it"
    }
  ]
}

Only include issues that are reasonable and actionable. Discard suggestions that are subjective or not well-founded.
Output ONLY the JSON object, no markdown fences.`;

    const response = await this.acpService.sendPrompt(handle, prompt);

    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
      return {
        reviewer: `${summarizerConfig.name} (Summarizer)`,
        aggregatedReview: parsed.aggregatedReview ?? response,
        issues: parsed.issues ?? [],
      };
    } catch {
      this.logger.warn('Failed to parse summarizer response as JSON, returning raw text');
      return {
        reviewer: `${summarizerConfig.name} (Summarizer)`,
        aggregatedReview: response,
        issues: [],
      };
    }
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/review/summarizer.service.spec.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/review/summarizer.service.ts src/review/summarizer.service.spec.ts
git commit -m "feat: add SummarizerService for Claude Code review aggregation"
```

---

### Task 7: ReviewService (Orchestration)

**Files:**
- Create: `src/review/review.service.ts`
- Create: `src/review/review.module.ts`
- Test: `src/review/review.service.spec.ts`

**Step 1: Write failing test**

Create `src/review/review.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { ReviewService } from './review.service.js';
import { CodeReaderService } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { SummarizerService } from './summarizer.service.js';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ReviewService', () => {
  let service: ReviewService;

  const mockCodeReader = {
    readGitDiff: vi.fn().mockResolvedValue('diff --git a/test.ts'),
    readFiles: vi.fn().mockResolvedValue([{ path: 'test.ts', content: 'const x = 1;' }]),
  };
  const mockCouncil = {
    dispatchReviews: vi.fn().mockResolvedValue([
      { reviewer: 'Gemini', review: 'Looks good' },
      { reviewer: 'Claude', review: 'LGTM' },
    ]),
  };
  const mockSummarizer = {
    summarize: vi.fn().mockResolvedValue({
      reviewer: 'Claude (Summarizer)',
      aggregatedReview: 'Code is clean.',
      issues: [],
    }),
  };
  const mockAcpService = { stopAll: vi.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: CodeReaderService, useValue: mockCodeReader },
        { provide: CouncilService, useValue: mockCouncil },
        { provide: SummarizerService, useValue: mockSummarizer },
        { provide: AcpService, useValue: mockAcpService },
        { provide: ConfigService, useValue: { getConfig: vi.fn() } },
      ],
    }).compile();
    service = module.get(ReviewService);
    vi.clearAllMocks();
  });

  it('should review git diff end-to-end', async () => {
    const result = await service.reviewDiff('/tmp/repo', 'main');
    expect(result.status).toBe('completed');
    expect(result.individualReviews.length).toBe(2);
    expect(result.summary).toBeDefined();
    expect(mockCodeReader.readGitDiff).toHaveBeenCalledWith('/tmp/repo', 'main');
  });

  it('should review files end-to-end', async () => {
    const result = await service.reviewFiles(['test.ts']);
    expect(result.status).toBe('completed');
    expect(result.individualReviews.length).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/review/review.service.spec.ts
```

Expected: FAIL (ReviewService not found)

**Step 3: Implement ReviewService**

Create `src/review/review.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CodeReaderService } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { SummarizerService } from './summarizer.service.js';
import { AcpService } from '../acp/acp.service.js';
import { ReviewResult } from './review.types.js';

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly codeReader: CodeReaderService,
    private readonly council: CouncilService,
    private readonly summarizer: SummarizerService,
    private readonly acpService: AcpService,
  ) {}

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

    const summary = await this.summarizer.summarize(individualReviews);

    return {
      id,
      status: 'completed',
      individualReviews,
      summary,
    };
  }
}
```

**Step 4: Create ReviewModule**

Create `src/review/review.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ReviewService } from './review.service.js';
import { CodeReaderService } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { SummarizerService } from './summarizer.service.js';

@Module({
  providers: [ReviewService, CodeReaderService, CouncilService, SummarizerService],
  exports: [ReviewService],
})
export class ReviewModule {}
```

**Step 5: Run tests to verify they pass**

```bash
npx vitest run src/review/review.service.spec.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/review/review.service.ts src/review/review.service.spec.ts src/review/review.module.ts
git commit -m "feat: add ReviewService orchestration and ReviewModule"
```

---

### Task 8: ReviewController (REST API)

**Files:**
- Create: `src/review/review.controller.ts`
- Modify: `src/review/review.module.ts` (add controller)
- Modify: `src/app.module.ts` (import modules)
- Test: `src/review/review.controller.spec.ts`

**Step 1: Write failing test**

Create `src/review/review.controller.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ReviewController', () => {
  let controller: ReviewController;
  const mockReviewService = {
    reviewDiff: vi.fn().mockResolvedValue({
      id: 'review-abc',
      status: 'completed',
      individualReviews: [],
      summary: { reviewer: 'Claude', aggregatedReview: 'OK', issues: [] },
    }),
    reviewFiles: vi.fn().mockResolvedValue({
      id: 'review-def',
      status: 'completed',
      individualReviews: [],
      summary: { reviewer: 'Claude', aggregatedReview: 'OK', issues: [] },
    }),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [ReviewController],
      providers: [{ provide: ReviewService, useValue: mockReviewService }],
    }).compile();
    controller = module.get(ReviewController);
  });

  it('should handle POST /review/diff', async () => {
    const result = await controller.reviewDiff({
      repoPath: '/tmp/repo',
      baseBranch: 'main',
    });
    expect(result.status).toBe('completed');
    expect(mockReviewService.reviewDiff).toHaveBeenCalledWith('/tmp/repo', 'main', undefined, undefined);
  });

  it('should handle POST /review/file', async () => {
    const result = await controller.reviewFiles({
      files: ['src/app.ts'],
    });
    expect(result.status).toBe('completed');
    expect(mockReviewService.reviewFiles).toHaveBeenCalledWith(['src/app.ts'], undefined, undefined);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/review/review.controller.spec.ts
```

Expected: FAIL (ReviewController not found)

**Step 3: Implement ReviewController**

Create `src/review/review.controller.ts`:
```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { ReviewService } from './review.service.js';
import { ReviewResult } from './review.types.js';

interface DiffReviewDto {
  repoPath: string;
  baseBranch?: string;
  checks?: string[];
  extraInstructions?: string;
}

interface FileReviewDto {
  files: string[];
  checks?: string[];
  extraInstructions?: string;
}

@Controller('review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post('diff')
  async reviewDiff(@Body() dto: DiffReviewDto): Promise<ReviewResult> {
    return this.reviewService.reviewDiff(
      dto.repoPath,
      dto.baseBranch ?? 'main',
      dto.checks,
      dto.extraInstructions,
    );
  }

  @Post('file')
  async reviewFiles(@Body() dto: FileReviewDto): Promise<ReviewResult> {
    return this.reviewService.reviewFiles(
      dto.files,
      dto.checks,
      dto.extraInstructions,
    );
  }
}
```

**Step 4: Update ReviewModule to include controller**

Add `ReviewController` to `src/review/review.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';
import { CodeReaderService } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { SummarizerService } from './summarizer.service.js';

@Module({
  controllers: [ReviewController],
  providers: [ReviewService, CodeReaderService, CouncilService, SummarizerService],
  exports: [ReviewService],
})
export class ReviewModule {}
```

**Step 5: Update AppModule**

Update `src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { CouncilConfigModule } from './config/config.module.js';
import { AcpModule } from './acp/acp.module.js';
import { ReviewModule } from './review/review.module.js';

@Module({
  imports: [CouncilConfigModule, AcpModule, ReviewModule],
})
export class AppModule {}
```

**Step 6: Update main.ts**

Update `src/main.ts`:
```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from './config/config.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  await configService.loadConfig();
  await app.listen(3000);
  console.log('Code Review Council API running on http://localhost:3000');
}
bootstrap();
```

**Step 7: Run tests to verify they pass**

```bash
npx vitest run src/review/review.controller.spec.ts
```

Expected: PASS

**Step 8: Commit**

```bash
git add src/review/review.controller.ts src/review/review.controller.spec.ts src/review/review.module.ts src/app.module.ts src/main.ts
git commit -m "feat: add ReviewController REST API and wire up AppModule"
```

---

### Task 9: CLI Commands (nest-commander)

**Files:**
- Create: `src/cli.ts`
- Create: `src/cli/cli.module.ts`
- Create: `src/cli/diff.command.ts`
- Create: `src/cli/file.command.ts`

**Step 1: Create CLI entry point**

Create `src/cli.ts`:
```typescript
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli/cli.module.js';

async function bootstrap() {
  await CommandFactory.run(CliModule, ['warn', 'error']);
}
bootstrap();
```

**Step 2: Create CliModule**

Create `src/cli/cli.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { CouncilConfigModule } from '../config/config.module.js';
import { AcpModule } from '../acp/acp.module.js';
import { ReviewModule } from '../review/review.module.js';
import { DiffCommand } from './diff.command.js';
import { FileCommand } from './file.command.js';

@Module({
  imports: [CouncilConfigModule, AcpModule, ReviewModule],
  providers: [DiffCommand, FileCommand],
})
export class CliModule {}
```

**Step 3: Implement DiffCommand**

Create `src/cli/diff.command.ts`:
```typescript
import { Command, CommandRunner, Option } from 'nest-commander';
import { ReviewService } from '../review/review.service.js';
import { ConfigService } from '../config/config.service.js';

@Command({ name: 'diff', description: 'Review git diff' })
export class DiffCommand extends CommandRunner {
  constructor(
    private readonly reviewService: ReviewService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(params: string[], options: Record<string, any>): Promise<void> {
    await this.configService.loadConfig(options.config);

    const repoPath = options.repo ?? process.cwd();
    const baseBranch = options.base ?? 'main';
    const checks = options.checks?.split(',') ?? [];
    const extra = options.extra;

    console.log('\n=== Code Review Council ===\n');
    console.log(`Repo: ${repoPath}`);
    console.log(`Base: ${baseBranch}`);
    console.log('Reviewing...\n');

    const result = await this.reviewService.reviewDiff(repoPath, baseBranch, checks, extra);

    this.printResult(result);
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

  private printResult(result: any) {
    console.log('=== Individual Reviews ===\n');
    for (const review of result.individualReviews) {
      console.log(`--- ${review.reviewer} ---`);
      console.log(review.review);
      console.log();
    }
    if (result.summary) {
      console.log('=== Summary (by ' + result.summary.reviewer + ') ===\n');
      console.log(result.summary.aggregatedReview);
      if (result.summary.issues.length > 0) {
        console.log('\nIssues:');
        for (const issue of result.summary.issues) {
          console.log(`  [${issue.severity}] ${issue.category}: ${issue.description}`);
          if (issue.suggestion) console.log(`    Fix: ${issue.suggestion}`);
          if (issue.agreedBy.length > 0) console.log(`    Agreed by: ${issue.agreedBy.join(', ')}`);
        }
      }
    }
  }
}
```

**Step 4: Implement FileCommand**

Create `src/cli/file.command.ts`:
```typescript
import { Command, CommandRunner, Option } from 'nest-commander';
import { ReviewService } from '../review/review.service.js';
import { ConfigService } from '../config/config.service.js';

@Command({ name: 'file', description: 'Review specific files' })
export class FileCommand extends CommandRunner {
  constructor(
    private readonly reviewService: ReviewService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(params: string[], options: Record<string, any>): Promise<void> {
    if (params.length === 0) {
      console.error('Please provide at least one file path.');
      process.exit(1);
    }

    await this.configService.loadConfig(options.config);

    const checks = options.checks?.split(',') ?? [];
    const extra = options.extra;

    console.log('\n=== Code Review Council ===\n');
    console.log(`Files: ${params.join(', ')}`);
    console.log('Reviewing...\n');

    const result = await this.reviewService.reviewFiles(params, checks, extra);

    // Reuse same print logic
    console.log('=== Individual Reviews ===\n');
    for (const review of result.individualReviews) {
      console.log(`--- ${review.reviewer} ---`);
      console.log(review.review);
      console.log();
    }
    if (result.summary) {
      console.log('=== Summary (by ' + result.summary.reviewer + ') ===\n');
      console.log(result.summary.aggregatedReview);
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

**Step 5: Build and verify CLI**

```bash
npm run build
node dist/cli.js --help
```

Expected: Shows `diff` and `file` subcommands.

**Step 6: Commit**

```bash
git add src/cli.ts src/cli/
git commit -m "feat: add CLI commands (diff, file) with nest-commander"
```

---

### Task 10: E2E Smoke Test

**Step 1: Build the full project**

```bash
npm run build
```

Expected: No errors.

**Step 2: Run all unit tests**

```bash
npx vitest run
```

Expected: All tests PASS.

**Step 3: Test CLI with real ACP backends**

```bash
node dist/cli.js file ../copilot-sdk-demo/webpage-analyzer-agent.js
```

Expected: Output shows individual reviews from each configured model, followed by a summarized report.

**Step 4: Test REST API**

Terminal 1:
```bash
node dist/main.js
```

Terminal 2:
```bash
curl -X POST http://localhost:3000/review/file \
  -H 'Content-Type: application/json' \
  -d '{"files":["../copilot-sdk-demo/webpage-analyzer-agent.js"]}'
```

Expected: Returns JSON with review results.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: e2e smoke test adjustments"
```
