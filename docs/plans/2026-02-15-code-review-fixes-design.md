# Code Review Council - Review Fixes Design

## Context

Code Review Council CLI 自我審查後發現 15 項問題，涵蓋資源管理、安全性、穩健性、程式碼品質與 CLI 體驗。本文件記錄經確認的修正方案。

## A. 資源管理與架構（High）

### A1. ACP client 累積不釋放
- `CouncilService.dispatchReviews` 改用 `Promise.allSettled`，失敗時清理已建立的 handle
- 多批次模式下，`ReviewService` 每批結束後呼叫 `stopAll()` 釋放資源

### A2. 分批後合併程式碼給 DecisionMaker
- 多批次模式下改傳檔案清單摘要（檔名 + 行數），不傳完整程式碼
- DecisionMaker prompt 中明確告知依據 reviewer 意見裁決

### A3. 敏感檔案排除
- `CodeReaderService` 加入 `SENSITIVE_PATTERNS` 排除清單
- 保留 `--others` 以支援審查未追蹤新檔案

## B. 穩健性與品質（Medium）

### B4. process.setMaxListeners 全域污染
- 移至 `cli.ts` bootstrap 階段設定一次固定值（30）
- 從 `AcpService` constructor 移除

### B5. JSON 解析脆弱
- 先嘗試 `JSON.parse(response.trim())`
- 失敗再用非貪婪 regex 並取最長有效 JSON 物件

### B6. ConfigService 缺 schema 驗證
- `loadConfig` 中加入結構檢查（不引入新依賴）
- 缺少必要欄位時 fail-fast 並回傳明確錯誤

### B7. 移除 `as any`
- 為 ACP session 選項與事件定義本地 interface
- 將 `any` 限縮到 SDK 邊界

### B8. Service 層 console.log
- 格式化輸出移至 CLI command 層
- Service 只回傳資料，不負責呈現

### B9. session.destroy() 空 catch
- 改為 `logger.warn` 記錄 destroy 失敗原因

### B10. 大檔案 OOM 防護
- 加入單檔 1MB 上限，超過跳過並 warn

### B13. Logger 注入規範
- `new Logger()` 改為 constructor 注入 `ConsoleLogger`

## C. CLI 細節（Low）

### C11. process.exit(1)
- 改為 `throw new Error()`，由框架處理退出

### C12. CLI 選項驗證
- checks: `.filter(Boolean)`
- batch-size: `isNaN` 檢查

### C14. timeout 浮點精度
- 使用 `(ms / 1000).toFixed(0)` 格式化

### C15. Promise.all 失敗不清理
- 改用 `Promise.allSettled` + 清理已建立 handle

## Affected Files

- `src/cli.ts`
- `src/acp/acp.service.ts`
- `src/review/review.service.ts`
- `src/review/council.service.ts`
- `src/review/decision-maker.service.ts`
- `src/review/code-reader.service.ts`
- `src/config/config.service.ts`
- `src/cli/file.command.ts`
- `src/cli/codebase.command.ts`
- `src/cli/diff.command.ts`
