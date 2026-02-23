# ACP 孤兒行程清理設計文件

日期：2026-02-23

## 問題

`crc` 被強制中止（SIGKILL、終端關閉）時，NestJS `onModuleDestroy` 不會執行，
`gemini`、`codex-acp`、`claude-code-acp` 等 ACP 子行程會留在系統中成為孤兒行程。
下一次執行前若不清理，這些行程會持續佔用資源。

## 實際行程形態（macOS）

| cliPath | 實際行程 |
|---------|---------|
| `gemini` | `node .../bin/gemini --experimental-acp`（可能 2 個） |
| `codex-acp` | `node .../bin/codex-acp` + `.../codex-acp-darwin-arm64/bin/codex-acp` |
| `claude-code-acp` | `node .../bin/claude-code-acp` |

## 設計

### Pattern 建構規則

```
pattern = cliArgs.includes('--experimental-acp')
  ? `${cliPath}.*--experimental-acp`
  : `${cliPath}`
```

| cliPath | cliArgs | pgrep pattern |
|---------|---------|--------------|
| `gemini` | `['--experimental-acp']` | `gemini.*--experimental-acp` |
| `codex-acp` | `[]` | `codex-acp` |
| `claude-code-acp` | `[]` | `claude-code-acp` |

### `AcpService.cleanupOrphanedProcesses(configs: ReviewerConfig[]): Promise<number>`

```
1. 從 configs（reviewers + decisionMaker）提取唯一 (cliPath, cliArgs) 組合
2. for each 組合：
   a. 建構 pattern
   b. pgrep -f <pattern> 取得 PID 清單（Unix）；Windows 跳過
   c. 過濾掉 process.pid（自身保護）
   d. process.kill(pid, 'SIGKILL') 逐一清除
3. 回傳 killed 數量
```

- `pgrep` 失敗（指令不存在）→ 靜默跳過，不中斷流程
- kill 失敗（行程已消失）→ 靜默跳過

### CLI 變更（三個 command 均適用）

新增 `--no-cleanup` flag：
- 預設：`loadConfig()` 之後、review 開始之前自動清理
- `--no-cleanup`：跳過清理直接執行

**受影響指令：**
- `crc codebase`
- `crc diff`
- `crc file`

### 輸出規格

```
# 有殘留
Cleaning up 2 orphaned ACP client(s)...
Killed gemini (PID 34998)
Killed codex-acp (PID 35000)

# 無殘留
（靜默）

# --no-cleanup
（靜默跳過）
```

## 影響範圍

| 檔案 | 變更類型 |
|------|---------|
| `src/acp/acp.service.ts` | 新增 `cleanupOrphanedProcesses` 方法 |
| `src/cli/codebase.command.ts` | 新增 `--no-cleanup` option，呼叫 cleanup |
| `src/cli/diff.command.ts` | 新增 `--no-cleanup` option，呼叫 cleanup |
| `src/cli/file.command.ts` | 新增 `--no-cleanup` option，呼叫 cleanup |

## 測試策略

- `cleanupOrphanedProcesses`：mock `execFile`（pgrep）與 `process.kill`，驗證：
  - pattern 建構正確（含 / 不含 `--experimental-acp`）
  - 自身 PID 被過濾
  - pgrep 無輸出時回傳 0
  - kill 失敗時不拋出
- `--no-cleanup` flag：驗證 cleanup 不被呼叫
