# Code Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 9 issues identified during code review, covering security hardening, bug fixes, and dead code removal.

**Architecture:** Each fix is independent and touches a single file (except Task E which touches 2 files). The fixes span CLI core (`src/`), API server (`apps/api/`), frontend (`apps/web/`), and shared types (`libs/shared/`).

**Tech Stack:** NestJS, Angular, TypeScript, Vitest, marked, DOMPurify

---

### Task 1: Add error logging to handleMessage catch (Item G)

**Files:**
- Modify: `apps/api/src/review/review.gateway.ts:41`

**Step 1: Inject ConsoleLogger into ReviewGateway**

Add `ConsoleLogger` to the constructor and import it:

```typescript
// In imports, add:
import { ConsoleLogger, Inject } from '@nestjs/common';

// In constructor:
constructor(
  private readonly reviewService: ReviewService,
  private readonly configService: ConfigService,
  @Inject(ConsoleLogger) private readonly logger: ConsoleLogger,
) {
  this.logger.setContext(ReviewGateway.name);
}
```

**Step 2: Replace silent catch with error logging + client notification**

Change line 41 from:

```typescript
this.handleMessage(client, msg).catch(() => {});
```

to:

```typescript
this.handleMessage(client, msg).catch((error) => {
  this.logger.error(
    `Unhandled error in handleMessage: ${error instanceof Error ? error.message : String(error)}`,
  );
  this.send(client, 'error', {
    message: error instanceof Error ? error.message : 'Internal error',
  });
});
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/api/src/review/review.gateway.ts
git commit -m "fix: add error logging to WebSocket handleMessage catch"
```

---

### Task 2: Bind API to 127.0.0.1 (Item B)

**Files:**
- Modify: `apps/api/src/main.ts:11`

**Step 1: Bind to localhost only**

Change line 11 from:

```typescript
await app.listen(3100);
```

to:

```typescript
await app.listen(3100, '127.0.0.1');
```

**Step 2: Update log message**

No change needed — the log already says `http://localhost:3100`.

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "fix: bind API server to 127.0.0.1 to prevent network exposure"
```

---

### Task 3: Validate config before writing in saveConfig (Item C)

**Files:**
- Modify: `apps/api/src/filesystem/filesystem.controller.ts:131-143`

**Step 1: Add validation before writeFile**

Change the `saveConfig` method to validate before writing:

```typescript
@Post('config/save')
async saveConfig(
  @Body() config: Record<string, unknown>,
): Promise<{ success: boolean }> {
  const configPath = resolve(process.cwd(), 'review-council.config.json');
  // 防禦性斷言：確保最終路徑的檔名是預期的設定檔名（深層防禦）
  if (basename(configPath) !== 'review-council.config.json') {
    throw new ForbiddenException('Invalid config path');
  }
  // 先驗證，再寫入
  const validation = this.configService.validateConfigData(config);
  if (!validation.valid) {
    throw new BadRequestException(
      `Invalid configuration: ${validation.error}`,
    );
  }
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  await this.configService.loadConfig(configPath);
  return { success: true };
}
```

**Step 2: Add BadRequestException to imports**

Add `BadRequestException` to the NestJS import at line 1:

```typescript
import { Controller, Get, Post, Query, Body, ConsoleLogger, Inject, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/api/src/filesystem/filesystem.controller.ts
git commit -m "fix: validate config data before writing to disk in saveConfig"
```

---

### Task 4: Add DOMPurify to sanitize markdown output (Item D)

**Files:**
- Modify: `apps/web/src/app/features/review/result-viewer.component.ts:305-308`

**Step 1: Install dompurify**

```bash
npm install dompurify
npm install -D @types/dompurify
```

**Step 2: Add DOMPurify import and update renderMarkdown**

At the top of the file, add:

```typescript
import DOMPurify from 'dompurify';
```

Change `renderMarkdown` method (lines 305-308) from:

```typescript
renderMarkdown(text: string): SafeHtml {
  const html = marked.parse(text, { async: false }) as string;
  return this.sanitizer.bypassSecurityTrustHtml(html);
}
```

to:

```typescript
renderMarkdown(text: string): SafeHtml {
  const raw = marked.parse(text, { async: false }) as string;
  const html = DOMPurify.sanitize(raw);
  return this.sanitizer.bypassSecurityTrustHtml(html);
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/web/src/app/features/review/result-viewer.component.ts package.json package-lock.json
git commit -m "fix: sanitize markdown output with DOMPurify to prevent XSS"
```

---

### Task 5: Fix buildReviewPrompt ignoring configOverride (Item E)

**Files:**
- Modify: `src/review/council.service.ts:46,278-279`
- Test: `src/review/council.service.spec.ts`

**Step 1: Write a failing test**

Add a test in `council.service.spec.ts` that verifies when `configOverride` is passed to `dispatchReviews`, the prompt uses the override's `review.language` instead of the global config's language.

```typescript
it('should use configOverride language in buildReviewPrompt', async () => {
  // Setup: global config has language 'zh-tw'
  // configOverride has language 'en'
  // Assert the prompt sent to sendPrompt contains 'en' language instructions
});
```

(Exact test depends on existing test patterns — see the spec file.)

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/review/council.service.spec.ts`
Expected: FAIL (prompt uses global 'zh-tw' instead of override 'en')

**Step 3: Fix buildReviewPrompt to accept config parameter**

Change line 46 from:

```typescript
const prompt = this.buildReviewPrompt(request);
```

to:

```typescript
const prompt = this.buildReviewPrompt(request, config);
```

Change the method signature (line 278-279) from:

```typescript
private buildReviewPrompt(request: ReviewRequest): string {
  const config = this.configService.getConfig();
```

to:

```typescript
private buildReviewPrompt(request: ReviewRequest, config: CouncilConfig): string {
```

Remove the `const config = this.configService.getConfig();` line (line 279).

Also check if `buildReviewPrompt` is called anywhere else in the file and update those call sites too (pass `config`).

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/review/council.service.spec.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm run test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/review/council.service.ts src/review/council.service.spec.ts
git commit -m "fix: pass configOverride to buildReviewPrompt instead of reading global config"
```

---

### Task 6: Add missing 'batch' to libs/shared mode type (Item F)

**Files:**
- Modify: `libs/shared/src/types/config.types.ts:17`

**Step 1: Add 'batch' to the mode union**

Change line 17 from:

```typescript
mode?: 'inline' | 'explore';
```

to:

```typescript
mode?: 'inline' | 'batch' | 'explore';
```

Note: `src/config/config.types.ts:18` already has `'batch'` — this aligns `libs/shared` with the core type.

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add libs/shared/src/types/config.types.ts
git commit -m "fix: add missing 'batch' to mode type in libs/shared config types"
```

---

### Task 7: Validate WebSocket config injection (Item A)

**Files:**
- Modify: `apps/api/src/review/review.gateway.ts:109-120`

**Step 1: Add validation in extractConfig**

Change `extractConfig` method to validate the merged config:

```typescript
private extractConfig(data: Record<string, unknown>): import('../../../../src/config/config.types.js').CouncilConfig | undefined {
  if (data.config && typeof data.config === 'object' && !Array.isArray(data.config)) {
    type CouncilConfig = import('../../../../src/config/config.types.js').CouncilConfig;
    const partial = data.config as Partial<CouncilConfig>;
    let merged: CouncilConfig;
    if (!partial.decisionMaker) {
      const serverCfg = this.configService.getConfig();
      merged = { ...serverCfg, ...partial, decisionMaker: serverCfg.decisionMaker };
    } else {
      merged = data.config as CouncilConfig;
    }
    // 驗證合併後的設定
    const validation = this.configService.validateConfigData(
      merged as unknown as Record<string, unknown>,
    );
    if (!validation.valid) {
      return undefined;
    }
    return merged;
  }
  return undefined;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/api/src/review/review.gateway.ts
git commit -m "fix: validate WebSocket config injection before use"
```

---

### Task 8: Add try-catch fallback to resolveExcludePatterns (Item H)

**Files:**
- Modify: `src/review/code-reader.service.ts:367-373`
- Test: `src/review/code-reader.service.spec.ts`

**Step 1: Write a failing test**

Add a test that verifies when `configService.getConfig()` throws (e.g. config not loaded), `resolveExcludePatterns` returns `DEFAULT_EXCLUDE_PATTERNS` instead of throwing.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/review/code-reader.service.spec.ts`
Expected: FAIL

**Step 3: Wrap getConfig() call in try-catch**

Change lines 367-373 from:

```typescript
private resolveExcludePatterns(options: CodebaseOptions): string[] {
  if (options.excludePatterns !== undefined) return options.excludePatterns;
  return (
    this.configService?.getConfig()?.review?.excludePatterns ??
    DEFAULT_EXCLUDE_PATTERNS
  );
}
```

to:

```typescript
private resolveExcludePatterns(options: CodebaseOptions): string[] {
  if (options.excludePatterns !== undefined) return options.excludePatterns;
  try {
    return (
      this.configService.getConfig().review?.excludePatterns ??
      DEFAULT_EXCLUDE_PATTERNS
    );
  } catch {
    return DEFAULT_EXCLUDE_PATTERNS;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/review/code-reader.service.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/review/code-reader.service.ts src/review/code-reader.service.spec.ts
git commit -m "fix: add try-catch fallback in resolveExcludePatterns"
```

---

### Task 9: Remove unused sanitizeIndented function (Item I)

**Files:**
- Modify: `src/cli/result-printer.ts:27-31`

**Step 1: Run tests before removal**

Run: `npm run test`
Expected: All tests pass

**Step 2: Delete the unused function**

Remove lines 27-31:

```typescript
/** Sanitize multiline text and indent continuation lines for aligned CLI output. */
function sanitizeIndented(text: string, indent: string): string {
  const clean = sanitize(text);
  return clean.replace(/\n/g, `\n${indent}`);
}
```

**Step 3: Run tests after removal**

Run: `npm run test`
Expected: All tests pass (function was unused)

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/cli/result-printer.ts
git commit -m "refactor: remove unused sanitizeIndented function"
```

---

## Execution Order

Tasks are independent and can be executed in any order. Suggested grouping:

1. **Quick fixes (no tests needed):** Tasks 1, 2, 3, 6, 7, 9
2. **With new tests:** Tasks 5, 8
3. **With npm install:** Task 4

Final verification after all tasks:

```bash
npm run test && npm run build
```
