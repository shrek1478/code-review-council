# Security Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修正 codebase 審查報告中 Decision Maker 確認的 7 個安全性與程式碼品質問題。

**Architecture:** 純本機開發工具（localhost only），修正集中在 `apps/api`（NestJS API）、`apps/web`（Angular 前端）、`src/`（CLI 核心）三處。每個 task 獨立可測，互不依賴。

**Tech Stack:** NestJS, Angular 17+（Signals）, Vitest, Node.js ESM, minimatch v3 (CJS)

---

## Task 1: `listDirectory` 限制為 home 目錄以下

**Files:**
- Modify: `apps/api/src/filesystem/filesystem.controller.ts:65-82`

**Step 1: 撰寫失敗測試（手動驗證替代）**

此 controller 無現有 spec 檔。以 curl 驗證（實作後執行）：
```bash
# 應回傳 403
curl -s http://localhost:3100/api/filesystem/list?path=/etc | jq .
```

**Step 2: 修改 `listDirectory` 方法**

在 `filesystem.controller.ts` 頂端加入 import：
```typescript
import { join, resolve, sep } from 'node:path';  // 新增 sep
import { ForbiddenException } from '@nestjs/common'; // 新增
```

將 `listDirectory` 方法改為：
```typescript
@Get('list')
async listDirectory(
  @Query('path') dirPath?: string,
): Promise<DirectoryEntry[]> {
  const root = this.defaultRoot;
  const targetPath = resolve(dirPath || root);
  // 限制只允許 home 目錄以下（含 home 本身）
  if (targetPath !== root && !targetPath.startsWith(root + sep)) {
    throw new ForbiddenException('Access outside home directory is not allowed');
  }
  const entries = await readdir(targetPath, { withFileTypes: true });

  const directories: DirectoryEntry[] = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({
      name: entry.name,
      path: join(targetPath, entry.name),
      isDirectory: true,
    }));

  return directories;
}
```

**Step 3: 執行既有測試確保未破壞其他功能**

```bash
npm run test
```
Expected: 155 tests passed (8 test files)

**Step 4: Commit**

```bash
git add apps/api/src/filesystem/filesystem.controller.ts
git commit -m "fix: restrict listDirectory to home directory subtree"
```

---

## Task 2: `saveConfig` 防禦性路徑驗證

**Files:**
- Modify: `apps/api/src/filesystem/filesystem.controller.ts:113-121`

**Step 1: 修改 `saveConfig` 方法**

在頂端 import 補上 `basename`：
```typescript
import { join, resolve, sep, basename } from 'node:path';
```

將 `saveConfig` 方法改為：
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
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  await this.configService.loadConfig(configPath);
  return { success: true };
}
```

**Step 2: 執行測試**

```bash
npm run test
```
Expected: 155 tests passed

**Step 3: Commit**

```bash
git add apps/api/src/filesystem/filesystem.controller.ts
git commit -m "fix: add defensive path validation in saveConfig"
```

---

## Task 3: CORS 限制為 localhost

**Files:**
- Modify: `apps/api/src/main.ts:9`

**Step 1: 修改 `main.ts`**

將第 9 行：
```typescript
app.enableCors();
```
改為：
```typescript
// 限制 CORS 來源為 localhost 任意 port（本機開發工具）
app.enableCors({ origin: /^http:\/\/localhost(:\d+)?$/, credentials: true });
```

**Step 2: 執行測試**

```bash
npm run test
```
Expected: 155 tests passed

**Step 3: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "fix: restrict CORS to localhost origins only"
```

---

## Task 4: `ConfigService` 新增公開驗證方法，`ConfigController` 重用

**Files:**
- Modify: `src/config/config.service.ts:211`
- Modify: `apps/api/src/config/config.controller.ts:13-33`

**Step 1: 在 `config.service.ts` 新增 public 方法**

在 `validateConfig`（private，第 211 行）**之前**插入：

```typescript
/**
 * 供外部呼叫的設定驗證入口，回傳 { valid, error } 而非 throw。
 */
validateConfigData(config: Record<string, unknown>): { valid: boolean; error?: string } {
  try {
    this.validateConfig(config as Record<string, any>, 'inline');
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid config',
    };
  }
}
```

**Step 2: 修改 `config.controller.ts`**

將整個 `validateConfig` 方法替換為：
```typescript
@Post('validate')
validateConfig(@Body() body: Record<string, unknown>) {
  return this.configService.validateConfigData(body);
}
```

**Step 3: 執行測試**

```bash
npm run test
```
Expected: 155 tests passed

**Step 4: Commit**

```bash
git add src/config/config.service.ts apps/api/src/config/config.controller.ts
git commit -m "refactor: reuse ConfigService validation logic in ConfigController"
```

---

## Task 5: WebSocket 訊息結構驗證

**Files:**
- Modify: `apps/api/src/review/review.gateway.ts:22-31`

**Step 1: 修改 `handleConnection` 的訊息處理**

將 `handleConnection` 的 `client.on('message', ...)` 回呼改為：

```typescript
handleConnection(client: WebSocket): void {
  client.on('message', (raw: Buffer | string) => {
    let msg: WsIncoming;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      this.send(client, 'error', { message: 'Invalid JSON' });
      return;
    }
    // 基本結構驗證：event 必須是非空字串，data 必須是非 null 物件
    if (
      typeof msg.event !== 'string' ||
      !msg.event ||
      typeof msg.data !== 'object' ||
      msg.data === null ||
      Array.isArray(msg.data)
    ) {
      this.send(client, 'error', { message: 'Invalid message format' });
      return;
    }
    this.handleMessage(client, msg).catch(() => {});
  });
}
```

**Step 2: 執行測試**

```bash
npm run test
```
Expected: 155 tests passed

**Step 3: Commit**

```bash
git add apps/api/src/review/review.gateway.ts
git commit -m "fix: validate WebSocket message structure before processing"
```

---

## Task 6: `while` 迴圈改用 UUID 後綴

**Files:**
- Modify: `apps/web/src/app/features/review/reviewer-selector.component.ts:263-273`

**Step 1: 修改 `addCli` 方法的重複名稱邏輯**

找到（約第 263-273 行）：
```typescript
let name = this.newCliName.trim() || cliPath;
// Ensure unique name to prevent progress-tracking conflicts in Live Output
const existingNames = new Set(this.agents().map(a => a.name));
if (existingNames.has(name)) {
  let suffix = 2;
  while (existingNames.has(`${name} (${suffix})`)) suffix++;
  name = `${name} (${suffix})`;
}
```

替換為：
```typescript
let name = this.newCliName.trim() || cliPath;
// 使用 UUID 前 8 碼確保名稱唯一，避免 while 迴圈潛在風險
const existingNames = new Set(this.agents().map(a => a.name));
if (existingNames.has(name)) {
  name = `${name} (${crypto.randomUUID().slice(0, 8)})`;
}
```

注意：`crypto` 在現代瀏覽器全域可用，無需額外 import。

**Step 2: 執行測試**

```bash
npm run test
```
Expected: 155 tests passed

**Step 3: Commit**

```bash
git add apps/web/src/app/features/review/reviewer-selector.component.ts
git commit -m "fix: replace while loop with UUID suffix for unique reviewer names"
```

---

## Task 7: 自訂 glob 匹配改用 minimatch

**Files:**
- Modify: `src/review/code-reader.service.ts:368-388`

**背景：** `minimatch` v3 為 CJS 模組，專案使用 ESM，需以 `createRequire` 匯入。`isExcludedFile` 是 public 方法，有間接測試覆蓋（透過 `readCodebase`/`listCodebaseFiles`）。

**Step 1: 撰寫針對 `isExcludedFile` 的直接測試**

在 `src/review/code-reader.service.spec.ts` 新增 `describe` 區塊（加在最後一個 `describe` 之後，`}` 結尾之前）：

```typescript
describe('isExcludedFile', () => {
  it('should exclude exact filename', () => {
    expect(service.isExcludedFile('node_modules/foo.ts', ['node_modules/**'])).toBe(true);
  });
  it('should not exclude non-matching path', () => {
    expect(service.isExcludedFile('src/foo.ts', ['node_modules/**'])).toBe(false);
  });
  it('should support * wildcard', () => {
    expect(service.isExcludedFile('dist/bundle.js', ['dist/*'])).toBe(true);
  });
  it('should support ? wildcard', () => {
    expect(service.isExcludedFile('src/a.ts', ['src/?.ts'])).toBe(true);
    expect(service.isExcludedFile('src/ab.ts', ['src/?.ts'])).toBe(false);
  });
  it('should match nested paths with **', () => {
    expect(service.isExcludedFile('a/b/c/foo.ts', ['a/**/foo.ts'])).toBe(true);
  });
});
```

**Step 2: 執行測試確認新增測試通過（現有 matchesGlob 已可通過）**

```bash
npm run test -- src/review/code-reader.service.spec.ts
```
Expected: 新增的 5 個測試全數 PASS（舊實作就已正確）

**Step 3: 替換 `matchesGlob` 為 minimatch**

在 `code-reader.service.ts` 頂端 import 區域加入：
```typescript
import { createRequire } from 'node:module';
// minimatch v3 為 CJS 模組，以 createRequire 匯入以相容 ESM
const _minimatch = createRequire(import.meta.url)('minimatch') as (
  path: string,
  pattern: string,
  opts?: { dot?: boolean; matchBase?: boolean },
) => boolean;
```

將 `matchesGlob` 私有方法（第 368-382 行）整個替換為：
```typescript
/** 使用 minimatch 進行 glob 匹配，支援 *, **, ? 等標準語法。 */
private matchesGlob(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return _minimatch(normalized, pattern, { dot: true });
}
```

**Step 4: 執行測試確認所有測試仍通過**

```bash
npm run test
```
Expected: 155+ tests passed（含新增的 5 個）

**Step 5: Commit**

```bash
git add src/review/code-reader.service.ts src/review/code-reader.service.spec.ts
git commit -m "fix: replace custom glob matcher with minimatch for standard glob behavior"
```

---

## 最終驗證

**Step 1: 執行完整測試套件**

```bash
npm run test
```
Expected: 全數通過

**Step 2: 執行 build 確認無 TypeScript 錯誤**

```bash
npm run build
```
Expected: 無錯誤輸出

**Step 3: Final commit（若有任何遺漏的 staged 變更）**

```bash
git status
```
