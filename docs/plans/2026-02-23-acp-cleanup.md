# ACP Orphan Process Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在每次 `crc` 指令啟動審查前，自動 kill 上一次執行中斷遺留的孤兒 ACP 子行程，並提供 `--no-cleanup` flag 供進階使用者跳過。

**Architecture:** 在 `AcpService` 新增 `cleanupOrphanedProcesses(configs)` 方法，用 `pgrep -f` 找符合 CLI 名稱的行程並 SIGKILL；三個 CLI command（codebase / diff / file）各注入 `AcpService`，在 `loadConfig()` 後、review 開始前呼叫清理，並新增 `--no-cleanup` 選項可跳過。

**Tech Stack:** NestJS, nest-commander, Node.js `child_process.execFile`, `process.kill`, Vitest

---

## Task 1: `AcpService.cleanupOrphanedProcesses` + 單元測試

**Files:**
- Modify: `src/acp/acp.service.ts`（在 `stopAll` 之後加入兩個新方法）
- Modify: `src/acp/acp.service.spec.ts`（加入 import 與新增 `describe` 區塊）

### Step 1：先閱讀 `acp.service.ts` 確認目前結構

```bash
# 確認 stopAll 結尾的行號，新方法加在它之後
```

目前已知結構（行號供參考，以實際讀取為準）：
- `stopAll()` 約第 308–321 行
- 類別結尾 `}` 約第 322 行

### Step 2：在 `src/acp/acp.service.spec.ts` 最頂端加入 `execFile` import

在第 1 行 `import { Test } ...` **之前**插入：

```typescript
import { execFile } from 'node:child_process';
```

### Step 3：在 spec 檔案最後的 `});`（整個 describe 的結尾）**之前**加入新的 `describe` 區塊

```typescript
  describe('cleanupOrphanedProcesses', () => {
    let killSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    });

    afterEach(() => {
      killSpy.mockRestore();
    });

    function mockPgrep(pids: number[]): void {
      (vi.mocked(execFile) as any).mockImplementationOnce(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, pids.map(String).join('\n') + '\n', '');
        },
      );
    }

    function mockPgrepNotFound(): void {
      (vi.mocked(execFile) as any).mockImplementationOnce(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(new Error('no matches'), '', '');
        },
      );
    }

    it('should return 0 and kill nothing when no processes found', async () => {
      mockPgrepNotFound();
      const killed = await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      expect(killed).toBe(0);
      expect(killSpy).not.toHaveBeenCalled();
    });

    it('should kill found PIDs and return count', async () => {
      mockPgrep([11111, 22222]);
      const killed = await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      expect(killed).toBe(2);
      expect(killSpy).toHaveBeenCalledWith(11111, 'SIGKILL');
      expect(killSpy).toHaveBeenCalledWith(22222, 'SIGKILL');
    });

    it('should skip own process PID', async () => {
      mockPgrep([process.pid, 99999]);
      const killed = await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      expect(killed).toBe(1);
      expect(killSpy).not.toHaveBeenCalledWith(process.pid, 'SIGKILL');
      expect(killSpy).toHaveBeenCalledWith(99999, 'SIGKILL');
    });

    it('should not throw when kill fails (process already gone)', async () => {
      mockPgrep([55555]);
      killSpy.mockImplementation(() => {
        throw new Error('ESRCH: no such process');
      });
      const killed = await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      expect(killed).toBe(0);
    });

    it('should use cliPath as pattern when no --experimental-acp in cliArgs', async () => {
      mockPgrep([]);
      await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      const pgrepArgs = (vi.mocked(execFile) as any).mock.calls.find(
        (c: any[]) => c[0] === 'pgrep',
      );
      // Since we used mockImplementationOnce, the real call order depends on mock setup.
      // Instead check via a fresh mock:
      // (see note below — pattern assertion done via separate test)
    });

    it('should append --experimental-acp to pattern when present in cliArgs', async () => {
      let capturedArgs: string[] = [];
      (vi.mocked(execFile) as any).mockImplementationOnce(
        (_cmd: string, args: string[], _opts: unknown, cb: Function) => {
          capturedArgs = args as string[];
          cb(null, '', '');
        },
      );
      await service.cleanupOrphanedProcesses([
        { name: 'Gemini', cliPath: 'gemini', cliArgs: ['--experimental-acp'] },
      ]);
      expect(capturedArgs[1]).toBe('gemini.*--experimental-acp');
    });

    it('should use plain cliPath pattern when no --experimental-acp', async () => {
      let capturedArgs: string[] = [];
      (vi.mocked(execFile) as any).mockImplementationOnce(
        (_cmd: string, args: string[], _opts: unknown, cb: Function) => {
          capturedArgs = args as string[];
          cb(null, '', '');
        },
      );
      await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      expect(capturedArgs[1]).toBe('codex-acp');
    });

    it('should deduplicate patterns from multiple configs with same cliPath', async () => {
      let callCount = 0;
      (vi.mocked(execFile) as any).mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          callCount++;
          cb(null, '', '');
        },
      );
      await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
        { name: 'Codex2', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      expect(callCount).toBe(1);
      // Restore mock for other tests
      (vi.mocked(execFile) as any).mockImplementation(
        (
          _cmd: string,
          args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout?: string) => void,
        ) => {
          const map: Record<string, string> = {
            copilot: '/usr/local/bin/copilot',
            gemini: '/usr/local/bin/gemini',
          };
          const resolved = map[args[0]];
          if (resolved) cb(null, resolved + '\n');
          else cb(new Error(`not found: ${args[0]}`));
        },
      );
    });
  });
```

### Step 4：執行測試確認新測試全部失敗（因為方法還不存在）

```bash
npm run test -- src/acp/acp.service.spec.ts 2>&1 | tail -20
```

Expected: 新加的 tests FAIL with `service.cleanupOrphanedProcesses is not a function`

### Step 5：在 `src/acp/acp.service.ts` 的 `stopAll` 方法**之後**、類別結尾 `}` **之前**加入以下程式碼

```typescript
  /** Returns PIDs of processes whose full command line contains `pattern`. */
  private findProcesses(pattern: string): Promise<number[]> {
    return new Promise((resolve) => {
      execFile(
        'pgrep',
        ['-f', pattern],
        { encoding: 'utf-8' },
        (err, stdout) => {
          if (err) {
            resolve([]);
            return;
          }
          const pids = (stdout as string)
            .split('\n')
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n) && n > 0);
          resolve(pids);
        },
      );
    });
  }

  /**
   * Kills orphaned ACP client processes left by a previous interrupted run.
   * Uses `pgrep -f` to match processes by their full command line.
   * No-op on Windows. Returns the number of processes killed.
   */
  async cleanupOrphanedProcesses(configs: ReviewerConfig[]): Promise<number> {
    if (process.platform === 'win32') return 0;

    // Build unique pattern → display-name map
    const patterns = new Map<string, string>();
    for (const config of configs) {
      const hasAcpFlag = config.cliArgs.includes('--experimental-acp');
      const pattern = hasAcpFlag
        ? `${config.cliPath}.*--experimental-acp`
        : config.cliPath;
      if (!patterns.has(pattern)) {
        patterns.set(pattern, config.name);
      }
    }

    let killed = 0;
    for (const [pattern, name] of patterns) {
      const pids = await this.findProcesses(pattern);
      for (const pid of pids) {
        if (pid === process.pid) continue;
        try {
          process.kill(pid, 'SIGKILL');
          this.logger.log(`Killed ${name} (PID ${pid})`);
          killed++;
        } catch {
          // Process already gone — silently skip
        }
      }
    }
    return killed;
  }
```

### Step 6：執行測試確認通過

```bash
npm run test -- src/acp/acp.service.spec.ts 2>&1 | tail -15
```

Expected: 所有 tests PASS（含新增的 7 個）

### Step 7：Commit

```bash
git add src/acp/acp.service.ts src/acp/acp.service.spec.ts
git commit -m "feat: add cleanupOrphanedProcesses to AcpService"
```

---

## Task 2: `CodebaseCommand` 加入 `--no-cleanup`

**Files:**
- Modify: `src/cli/codebase.command.ts`

**背景：**
- `AcpModule` 已標記 `@Global()` 並 export `AcpService`，可直接注入，不需修改 `CliModule`
- `--no-cleanup` 在 Commander.js 中是 boolean negation flag：預設 `cleanup = true`，傳入 `--no-cleanup` 後 `options.cleanup === false`

### Step 1：修改 `src/cli/codebase.command.ts`

**1a. 在 import 區加入 `AcpService`：**

```typescript
import { AcpService } from '../acp/acp.service.js';
```

**1b. 將 constructor 改為：**

```typescript
  constructor(
    @Inject(ReviewService) private readonly reviewService: ReviewService,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(AcpService) private readonly acpService: AcpService,
  ) {
    super();
  }
```

**1c. 在 `run` 方法中，`loadConfig` 之後、`const directory = ...` 之前加入：**

```typescript
    if ((options as Record<string, unknown>).cleanup !== false) {
      const cfg = this.configService.getConfig();
      const allConfigs = [...cfg.reviewers, cfg.decisionMaker];
      const killed = await this.acpService.cleanupOrphanedProcesses(allConfigs);
      if (killed > 0) console.log('');
    }
```

**1d. 在最後一個 `@Option` 之後加入新選項：**

```typescript
  @Option({
    flags: '--no-cleanup',
    description: 'Skip orphaned ACP client cleanup before reviewing',
  })
  parseNoCleanup(): boolean {
    return false;
  }
```

### Step 2：執行完整測試

```bash
npm run test 2>&1 | tail -10
```

Expected: 161 passed, 1 pre-existing failure（ConfigService loadConfig test）

### Step 3：Commit

```bash
git add src/cli/codebase.command.ts
git commit -m "feat: add --no-cleanup flag to codebase command"
```

---

## Task 3: `DiffCommand` 加入 `--no-cleanup`

**Files:**
- Modify: `src/cli/diff.command.ts`

### Step 1：修改 `src/cli/diff.command.ts`

**1a. 在 import 區加入 `AcpService`：**

```typescript
import { AcpService } from '../acp/acp.service.js';
```

**1b. 將 constructor 改為：**

```typescript
  constructor(
    @Inject(ReviewService) private readonly reviewService: ReviewService,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(AcpService) private readonly acpService: AcpService,
  ) {
    super();
  }
```

**1c. 在 `run` 方法中，`loadConfig` 之後、`const repoPath = ...` 之前加入：**

```typescript
    if ((options as Record<string, unknown>).cleanup !== false) {
      const cfg = this.configService.getConfig();
      const allConfigs = [...cfg.reviewers, cfg.decisionMaker];
      const killed = await this.acpService.cleanupOrphanedProcesses(allConfigs);
      if (killed > 0) console.log('');
    }
```

**1d. 在最後一個 `@Option` 之後加入：**

```typescript
  @Option({
    flags: '--no-cleanup',
    description: 'Skip orphaned ACP client cleanup before reviewing',
  })
  parseNoCleanup(): boolean {
    return false;
  }
```

### Step 2：執行完整測試

```bash
npm run test 2>&1 | tail -10
```

Expected: 161 passed, 1 pre-existing failure

### Step 3：Commit

```bash
git add src/cli/diff.command.ts
git commit -m "feat: add --no-cleanup flag to diff command"
```

---

## Task 4: `FileCommand` 加入 `--no-cleanup`

**Files:**
- Modify: `src/cli/file.command.ts`

### Step 1：修改 `src/cli/file.command.ts`

**1a. 在 import 區加入 `AcpService`：**

```typescript
import { AcpService } from '../acp/acp.service.js';
```

**1b. 將 constructor 改為：**

```typescript
  constructor(
    @Inject(ReviewService) private readonly reviewService: ReviewService,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(AcpService) private readonly acpService: AcpService,
  ) {
    super();
  }
```

**1c. 在 `run` 方法中，`if (params.length === 0)` 檢查之後、`loadConfig` **之後**、`const config = ...` 之前加入：**

```typescript
    if ((options as Record<string, unknown>).cleanup !== false) {
      const cfg = this.configService.getConfig();
      const allConfigs = [...cfg.reviewers, cfg.decisionMaker];
      const killed = await this.acpService.cleanupOrphanedProcesses(allConfigs);
      if (killed > 0) console.log('');
    }
```

**1d. 在最後一個 `@Option` 之後加入：**

```typescript
  @Option({
    flags: '--no-cleanup',
    description: 'Skip orphaned ACP client cleanup before reviewing',
  })
  parseNoCleanup(): boolean {
    return false;
  }
```

### Step 2：執行完整測試

```bash
npm run test 2>&1 | tail -10
```

Expected: 161 passed, 1 pre-existing failure

### Step 3：Commit

```bash
git add src/cli/file.command.ts
git commit -m "feat: add --no-cleanup flag to file command"
```

---

## 最終驗證

### Step 1：完整測試

```bash
npm run test 2>&1 | tail -15
```

Expected: 161+ passed, 1 pre-existing failure

### Step 2：Build

```bash
npm run build 2>&1 | tail -5
```

Expected: 無錯誤

### Step 3：手動驗證（需要終端）

```bash
# 終端 A：啟動一次 crc，立刻 Ctrl+C 中斷
crc codebase --path . &
sleep 3
kill -9 $!

# 確認孤兒行程存在
ps aux | grep -E 'gemini|codex-acp|claude-code-acp' | grep -v grep

# 終端 B：再次執行 crc，應看到 "Cleaned up..." log
crc codebase --path .

# 測試 --no-cleanup：孤兒行程應保留
crc codebase --path . --no-cleanup
```
