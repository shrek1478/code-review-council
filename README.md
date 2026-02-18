# Code Review Council

多模型 AI Code Review 工具，同時派遣多個 AI 模型（Gemini、Claude、Copilot）審查程式碼，再由決策模型統整所有意見，產出完整的 review 報告。

## 功能

- **diff** — 審查 git 分支差異（適合 PR review）
- **file** — 審查指定檔案
- **codebase** — 掃描整個專案目錄，自動分批送審

## 安裝

```bash
# 設定 GitHub Packages registry
echo "@shrek1478:registry=https://npm.pkg.github.com" >> ~/.npmrc

# 全域安裝
npm install -g @shrek1478/code-review-council
```

### 前置需求

需要安裝至少一個 AI CLI 工具。支援 ACP（Agent Client Protocol）和 Copilot 原生 protocol 兩種通訊方式：

| 工具 | 安裝方式 | Protocol | 設定方式 |
|------|---------|----------|---------|
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` | ACP | `"cliArgs": ["--experimental-acp"]` |
| [Claude Code ACP](https://github.com/zed-industries/claude-code-acp) | `npm install -g @zed-industries/claude-code-acp` | ACP | （預設 ACP 模式） |
| [GitHub Copilot CLI](https://github.com/github/copilot-cli) | `npm install -g @github/copilot` | Copilot | `"protocol": "copilot"` |

> Copilot CLI 支援原生 Copilot SDK protocol，透過設定 `"protocol": "copilot"` 啟用，不需要 `--acp` 參數。其他 CLI 預設使用 ACP protocol。

## 快速開始

### 1. 建立設定檔

在家目錄建立 `~/.code-review-council/review-council.config.json`：

```bash
mkdir -p ~/.code-review-council
```

```json
{
  "reviewers": [
    {
      "name": "Gemini",
      "cliPath": "gemini",
      "cliArgs": ["--experimental-acp"],
      "timeoutMs": 120000,
      "maxRetries": 2
    }
  ],
  "decisionMaker": {
    "name": "Claude",
    "cliPath": "claude-code-acp",
    "cliArgs": [],
    "timeoutMs": 600000,
    "maxRetries": 2
  },
  "review": {
    "defaultChecks": ["code-quality", "security", "performance", "readability", "best-practices"],
    "language": "zh-tw"
  }
}
```

> **Note**: `cliPath` 填寫安裝後的 CLI 命令名稱（如 `gemini`、`claude-code-acp`、`copilot`），`cliArgs` 填寫啟動 ACP 模式所需的參數。

### 2. 執行審查

```bash
# 審查當前分支與 main 的差異（自動讀取 ~/.code-review-council/review-council.config.json）
code-review-council diff --repo . --base main
```

## CLI 指令

### `diff` — 審查 Git 差異

```bash
code-review-council diff --repo /path/to/repo --base main --config ./my-config.json
```

| 選項 | 說明 | 預設值 |
|------|------|--------|
| `--repo <path>` | Git 儲存庫路徑 | 當前目錄 |
| `--base <branch>` | 基準分支 | `main` |
| `--checks <list>` | 逗號分隔的檢查類別 | 設定檔的 defaultChecks |
| `--extra <text>` | 額外審查指示 | — |
| `--config <path>` | 設定檔路徑 | 自動搜尋（見載入優先順序） |

### `file` — 審查指定檔案

```bash
code-review-council file src/app.ts src/main.ts --config ./my-config.json
```

| 選項 | 說明 |
|------|------|
| `<files...>` | 檔案路徑（至少一個） |
| `--checks <list>` | 檢查類別 |
| `--extra <text>` | 額外審查指示 |
| `--config <path>` | 設定檔路徑 |

### `codebase` — 審查整個專案

```bash
code-review-council codebase --dir ./src --config ./my-config.json
```

| 選項 | 說明 | 預設值 |
|------|------|--------|
| `--dir <path>` | 掃描目錄 | 當前目錄 |
| `--extensions <list>` | 逗號分隔的副檔名（如 `ts,js,py`） | 常見程式語言副檔名 |
| `--batch-size <chars>` | 每批最大字元數 | 100,000 |
| `--checks <list>` | 檢查類別 |
| `--extra <text>` | 額外審查指示 |
| `--config <path>` | 設定檔路徑 |

## 設定檔

### 載入優先順序

1. `--config <path>` — CLI 指定的路徑
2. `CONFIG_JSON` 環境變數 — JSON 字串形式的完整設定
3. `./review-council.config.json` — 當前工作目錄（專案層級）
4. `~/.code-review-council/review-council.config.json` — 使用者家目錄（使用者層級）
5. 內建預設設定 — package 附帶的設定

### 設定檔放置位置

**使用者層級**（推薦）— 全域安裝後，建立一次即可在所有專案使用：

```bash
mkdir -p ~/.code-review-council
cp review-council.config.json ~/.code-review-council/
# 或自行建立設定檔
```

**專案層級** — 放在專案根目錄，優先於使用者層級設定：

```bash
my-project/
├── review-council.config.json   # 專案專屬設定（優先）
├── src/
├── package.json
└── ...
```

### 完整設定範例

```json
{
  "reviewers": [
    {
      "name": "Gemini",
      "cliPath": "gemini",
      "cliArgs": ["--experimental-acp"],
      "timeoutMs": 120000,
      "maxRetries": 2
    },
    {
      "name": "Copilot",
      "cliPath": "copilot",
      "cliArgs": [],
      "protocol": "copilot",
      "model": "gpt-5-mini",
      "timeoutMs": 120000,
      "maxRetries": 2
    }
  ],
  "decisionMaker": {
    "name": "Claude",
    "cliPath": "claude-code-acp",
    "cliArgs": [],
    "timeoutMs": 600000,
    "maxRetries": 2
  },
  "review": {
    "defaultChecks": ["code-quality", "security", "performance", "readability", "best-practices"],
    "language": "zh-tw",
    "maxReviewsLength": 60000,
    "maxCodeLength": 100000,
    "maxSummaryLength": 60000,
    "mode": "inline"
  }
}
```

### 設定欄位說明

#### `reviewers[]` — 審查器

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `name` | string | ✓ | 審查器名稱 |
| `cliPath` | string | ✓ | CLI 執行檔路徑 |
| `cliArgs` | string[] | ✓ | CLI 啟動參數 |
| `protocol` | string | — | 通訊協定：`"acp"`（預設）或 `"copilot"` |
| `model` | string | — | 指定模型 |
| `timeoutMs` | number | — | 超時時間（預設 180,000ms；explore 模式自動加倍） |
| `maxRetries` | number | — | 重試次數 0-5（預設 0） |

#### `decisionMaker` — 決策模型

統整所有審查意見的模型，欄位同 `reviewers`。

#### `review` — 審查設定

| 欄位 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| `defaultChecks` | string[] | — | 預設檢查類別 |
| `language` | string | `zh-tw` | 輸出語言 |
| `maxReviewsLength` | number | 60,000 | 審查結果最大字元數 |
| `maxCodeLength` | number | 100,000 | 程式碼最大字元數 |
| `maxSummaryLength` | number | 60,000 | 摘要最大字元數 |
| `mode` | string | `"inline"` | 審查模式：`"inline"`（程式碼嵌入 prompt）或 `"explore"`（審查器自行讀取檔案） |
| `extensions` | string[] | — | 掃描的副檔名（如 `[".ts", ".js"]`），預設涵蓋常見程式語言 |
| `sensitivePatterns` | string[] | — | 敏感檔案的 regex 模式（如 `["^\\.env", "\\.key$"]`），匹配的檔案會被排除 |

### 環境變數覆蓋

| 環境變數 | 說明 |
|---------|------|
| `CONFIG_JSON` | JSON 字串形式的完整設定（覆蓋設定檔） |
| `DECISION_MAKER_MODEL` | 覆蓋決策模型名稱 |
| `REVIEW_LANGUAGE` | 覆蓋審查語言 |
| `DECISION_MAKER_TIMEOUT_MS` | 覆蓋決策模型超時 |
| `REVIEWER_TIMEOUT_MS` | 覆蓋所有審查器超時 |
| `REVIEWER_EXPLORE_LOCAL` | 覆蓋審查模式（`true` → explore，`false` → inline） |

## 檢查類別

| 類別 | 說明 |
|------|------|
| `code-quality` | 命名、結構、可讀性 |
| `security` | 漏洞、認證、驗證 |
| `performance` | 算法複雜度、記憶體使用 |
| `readability` | 註解、文檔、清晰度 |
| `best-practices` | 框架慣例、設計模式 |

## 使用範例

### PR 審查

```bash
cd /path/to/my-repo
code-review-council diff --base main --config ./my-config.json
```

### 安全性專項審查

```bash
code-review-council codebase \
  --dir ./src \
  --checks "security" \
  --extra "Focus on SQL injection, XSS, authentication" \
  --config ./my-config.json
```

### 使用環境變數（適合 CI/CD）

```bash
CONFIG_JSON='{"reviewers":[{"name":"Gemini","cliPath":"gemini","cliArgs":["--experimental-acp"]}],"decisionMaker":{"name":"Claude","cliPath":"claude-code-acp","cliArgs":[]},"review":{"defaultChecks":["security"],"language":"en"}}' \
  code-review-council diff --repo .
```

## 審查流程

```
程式碼 ──→ 並行派遣給多個 Reviewers ──→ 決策模型統整 ──→ 最終報告
              │                              │
              ├─ Gemini ────┐                │
              ├─ Copilot ───┼─→ 收集意見 ───→ Claude (Decision Maker)
              └─ Claude ────┘                │
                                             ↓
                                     ┌─────────────┐
                                     │  Final Report │
                                     │  - Decisions  │
                                     │  - Findings   │
                                     └─────────────┘
```

## 技術架構

- **框架**: NestJS 11 (ESM)
- **CLI**: nest-commander
- **Git 操作**: simple-git
- **AI 整合**: @shrek1478/copilot-sdk-with-acp (ACP / Copilot protocol)
- **測試**: Vitest

```
src/
├── cli.ts                        # CLI 進入點
├── constants.ts                  # 全域常數
├── cli/
│   ├── cli.module.ts             # CLI 模組
│   ├── diff.command.ts           # diff 指令
│   ├── file.command.ts           # file 指令
│   ├── codebase.command.ts       # codebase 指令
│   └── result-printer.ts         # 結果格式化輸出
├── config/
│   ├── config.module.ts          # 設定模組
│   ├── config.service.ts         # 設定載入與驗證
│   └── config.types.ts           # 設定型別定義
├── review/
│   ├── review.module.ts          # 審查模組
│   ├── code-reader.service.ts    # 讀取 diff / 檔案 / 目錄
│   ├── council.service.ts        # 派遣多模型審查
│   ├── decision-maker.service.ts # 統整決策
│   ├── review.service.ts         # 流程編排
│   ├── review.types.ts           # 型別定義
│   └── retry-utils.ts            # 重試邏輯（指數退避）
└── acp/
    ├── acp.module.ts             # ACP 模組
    └── acp.service.ts            # ACP / Copilot 客戶端管理
```

## 開發

```bash
git clone https://github.com/shrek1478/code-review-council.git
cd code-review-council
npm install
npm run build
npm test
```

## 授權

MIT
