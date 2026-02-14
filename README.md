# Code Review Council

多模型 AI Code Review 工具，同時派遣多個 AI 模型（Gemini、Claude、Codex）審查程式碼，再由摘要模型統整所有意見，產出完整的 review 報告。

## 功能

- **diff** — 審查 git 分支差異
- **file** — 審查指定檔案
- **codebase** — 掃描整個專案目錄，自動分批送審

支援 CLI 與 REST API 兩種使用方式。

## 技術架構

- **框架**: NestJS 11 (ESM)
- **CLI**: nest-commander
- **Git 操作**: simple-git
- **AI 整合**: GitHub Copilot SDK (ACP)
- **測試**: Vitest

```
src/
├── cli/                  # CLI 指令 (diff, file, codebase)
├── config/               # 設定檔管理
├── review/               # 核心 review 邏輯
│   ├── code-reader       # 讀取 diff / 檔案 / codebase
│   ├── council           # 派遣多模型審查
│   ├── summarizer        # 統整多份 review
│   ├── review.service    # 流程編排
│   └── review.controller # REST API
├── acp/                  # ACP 客戶端管理
├── cli.ts                # CLI 進入點
└── main.ts               # HTTP 伺服器進入點
```

## 安裝

```bash
npm install
npm run build
```

## CLI 使用方式

### 審查 git diff

```bash
node dist/cli.js diff --repo /path/to/repo --base main
```

### 審查指定檔案

```bash
node dist/cli.js file src/app.ts src/main.ts
```

### 審查整個 codebase

```bash
node dist/cli.js codebase --dir /path/to/project
```

可選參數：

| 參數 | 說明 | 預設值 |
|------|------|--------|
| `--dir <path>` | 專案目錄路徑 | 當前目錄 |
| `--extensions <list>` | 逗號分隔的副檔名 (如 `ts,js,py`) | 常見程式語言副檔名 |
| `--batch-size <chars>` | 每批最大字元數 | 100,000 |
| `--checks <list>` | 逗號分隔的檢查類別 | 設定檔中的 defaultChecks |
| `--extra <text>` | 額外的 review 指示 | — |
| `--config <path>` | 設定檔路徑 | `review-council.config.json` |

## REST API

啟動 HTTP 伺服器：

```bash
npm run start
```

伺服器預設監聽 `http://localhost:3000`。

### `POST /review/diff`

```json
{
  "repoPath": "/path/to/repo",
  "baseBranch": "main",
  "checks": ["security", "performance"],
  "extraInstructions": "請特別注意 SQL injection"
}
```

### `POST /review/file`

```json
{
  "files": ["src/app.ts", "src/main.ts"],
  "checks": ["code-quality"]
}
```

### `POST /review/codebase`

```json
{
  "directory": "/path/to/project",
  "extensions": [".ts", ".js"],
  "maxBatchSize": 100000,
  "checks": ["security", "best-practices"]
}
```

## 設定檔

`review-council.config.json`：

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

## 測試

```bash
npx vitest run
```

## 授權

UNLICENSED
