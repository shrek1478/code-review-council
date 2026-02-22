# Code Review Council

多模型 AI Code Review 工具，同時派遣多個 AI 模型（Gemini、Copilot、Codex、Claude）審查程式碼，再由決策模型統整所有意見，產出完整的 review 報告。

提供兩種使用方式：**Web 介面**（圖形化操作）與 **CLI**（終端機指令）。

## 功能

- **diff** — 審查 git 分支差異（適合 PR review）
- **file** — 審查指定檔案
- **codebase** — 掃描整個專案目錄，自動分批送審

### Web 介面特有功能

- 自動偵測已安裝的 CLI 工具，勾選即可啟用
- 手動新增 CLI 項目（同一 CLI 可同時擔任 Reviewer 與 Decision Maker）
- 即時 Live Output：各審查員進度與串流回應同步顯示
- Final Decision 整合報告與一鍵下載（JSON / Markdown）

## 安裝

### 前置需求

需要安裝至少一個 AI CLI 工具：

| 工具 | 安裝方式 | Protocol | 設定方式 |
|------|---------|----------|---------|
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` | ACP | `"cliArgs": ["--experimental-acp"]` |
| [GitHub Copilot CLI](https://github.com/github/copilot-cli) | `npm install -g @github/copilot` | Copilot | `"protocol": "copilot"` |
| [Codex CLI](https://github.com/openai/codex) | `npm install -g @openai/codex` | ACP | （預設 ACP 模式） |
| [Claude Code ACP](https://github.com/zed-industries/claude-code-acp) | `npm install -g @zed-industries/claude-code-acp` | ACP | （預設 ACP 模式） |

> Copilot CLI 支援原生 Copilot SDK protocol，透過設定 `"protocol": "copilot"` 啟用，不需要 `--acp` 參數。其他 CLI 預設使用 ACP protocol。

---

## 快速開始：Web 介面

### 1. 安裝依賴 & 建置

```bash
git clone https://github.com/shrek1478/code-review-council.git
cd code-review-council
npm install
npx nx run api:build
npx nx run web:build
```

### 2. 啟動服務

使用 `srvctl.sh` 一鍵管理前後端：

```bash
./srvctl.sh start    # 啟動 API（port 3100）+ Web（port 4200）
./srvctl.sh status   # 查看服務狀態
./srvctl.sh logs     # 即時追蹤 log
./srvctl.sh stop     # 停止所有服務
./srvctl.sh restart  # 重啟
```

### 3. 開啟瀏覽器

前往 [http://localhost:4200](http://localhost:4200)

### Web 介面操作說明

```
┌─────────────────────────────────────┬──────────────────────────────────────┐
│           左側控制面板               │           右側 Live Output            │
├─────────────────────────────────────┤                                      │
│ Mode:  Inline | Batch | Explore     │  審查進行中：                         │
│ Analysis: Codebase | Diff | File    │  ┌── Gemini ──── ● Waiting...        │
│                                     │  ├── Copilot ─── ✓ Done              │
│ Directory / Repo / File Paths       │  └── Codex ───── ✓ Done              │
│                                     │                                      │
│ Extra Instructions                  │  Decision Maker is reviewing...       │
│                                     │  ┌── Copilot DM ─ ● Waiting...       │
│ CLIS:                               │                                      │
│  ☑ Gemini     [Installed]           │  完成後：                             │
│  ☑ Copilot    [Installed]           │  Individual Reviews / Final Decision  │
│  ☐ Codex      [Installed]           │  下載 JSON / Markdown                 │
│  ☐ Claude     [Installed]           │                                      │
│  ☑ Copilot(2) [Installed] ×         │                                      │
│  ＋ Add CLI                         │                                      │
├─────────────────────────────────────┤                                      │
│        [ Start Review ]             │                                      │
└─────────────────────────────────────┴──────────────────────────────────────┘
```

**CLIS 區塊說明：**
- 自動偵測已安裝的 CLI，勾選即啟用
- 每個 CLI 可設定角色：**Reviewer**（負責審查）或 **Decision Maker**（統整決策）
- Copilot protocol 的 CLI 可額外指定模型
- 點擊「**＋ Add CLI**」手動新增 — 可讓同一 CLI 同時以 Reviewer 和 Decision Maker 兩種身份出現
- 手動新增的項目右側有 **×** 按鈕可刪除

---

## 快速開始：CLI

### 1. 安裝

```bash
# 設定 GitHub Packages registry
echo "@shrek1478:registry=https://npm.pkg.github.com" >> ~/.npmrc

# 全域安裝
npm install -g @shrek1478/code-review-council
```

### 2. 建立設定檔

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
      "timeoutMs": 600000,
      "maxRetries": 0
    },
    {
      "name": "Copilot",
      "cliPath": "copilot",
      "cliArgs": [],
      "protocol": "copilot",
      "model": "claude-sonnet-4.5",
      "timeoutMs": 600000,
      "maxRetries": 0
    },
    {
      "name": "Codex",
      "cliPath": "codex-acp",
      "cliArgs": [],
      "timeoutMs": 240000,
      "maxRetries": 0
    },
    {
      "name": "Claude",
      "cliPath": "claude-code-acp",
      "cliArgs": [],
      "timeoutMs": 600000,
      "maxRetries": 0
    }
  ],
  "decisionMaker": {
    "name": "Copilot DM",
    "cliPath": "copilot",
    "cliArgs": [],
    "protocol": "copilot",
    "model": "gpt-5-mini",
    "timeoutMs": 600000,
    "maxRetries": 0
  },
  "review": {
    "defaultChecks": ["code-quality", "security", "performance", "readability", "best-practices"],
    "language": "zh-tw",
    "mode": "explore"
  }
}
```

> **Note**: `cliPath` 填寫安裝後的 CLI 命令名稱，`cliArgs` 填寫啟動 ACP 模式所需的參數。Copilot CLI 使用原生 protocol 時設定 `"protocol": "copilot"`，可透過 `"model"` 指定模型。同一 CLI 擔任 Reviewer 與 Decision Maker 時，`name` 欄位須不同（如 `"Copilot"` 與 `"Copilot DM"`）以區分進度追蹤。

### 3. 執行審查

```bash
# 審查當前分支與 main 的差異（自動讀取 ~/.code-review-council/review-council.config.json）
code-review-council diff --repo . --base main
```

---

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

---

## 設定檔

### 載入優先順序

1. `--config <path>` — CLI 指定的路徑
2. `CONFIG_JSON` 環境變數 — JSON 字串形式的完整設定
3. `~/.code-review-council/review-council.config.json` — 使用者家目錄（使用者層級，推薦）
4. `./review-council.config.json` — 當前工作目錄（專案層級）
5. 內建預設設定 — package 附帶的設定

### 設定檔放置位置

**使用者層級**（推薦）— 全域安裝後，建立一次即可在所有專案使用：

```bash
mkdir -p ~/.code-review-council
cp review-council.config.json ~/.code-review-council/
```

**專案層級** — 放在專案根目錄，當使用者層級設定不存在時使用：

```
my-project/
├── review-council.config.json   # 專案專屬設定
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
      "timeoutMs": 600000,
      "maxRetries": 0
    },
    {
      "name": "Copilot",
      "cliPath": "copilot",
      "cliArgs": [],
      "protocol": "copilot",
      "model": "claude-sonnet-4.5",
      "timeoutMs": 600000,
      "maxRetries": 0
    },
    {
      "name": "Codex",
      "cliPath": "codex-acp",
      "cliArgs": [],
      "timeoutMs": 240000,
      "maxRetries": 0
    },
    {
      "name": "Claude",
      "cliPath": "claude-code-acp",
      "cliArgs": [],
      "timeoutMs": 600000,
      "maxRetries": 0
    }
  ],
  "decisionMaker": {
    "name": "Copilot DM",
    "cliPath": "copilot",
    "cliArgs": [],
    "protocol": "copilot",
    "model": "gpt-5-mini",
    "timeoutMs": 600000,
    "maxRetries": 0
  },
  "review": {
    "defaultChecks": ["code-quality", "security", "performance", "readability", "best-practices"],
    "language": "zh-tw",
    "maxReviewsLength": 60000,
    "maxCodeLength": 100000,
    "maxSummaryLength": 60000,
    "mode": "explore"
  }
}
```

### 設定欄位說明

#### `reviewers[]` — 審查器

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `name` | string | ✓ | 審查器名稱（同一 CLI 擔任多角色時須唯一） |
| `cliPath` | string | ✓ | CLI 執行檔路徑 |
| `cliArgs` | string[] | ✓ | CLI 啟動參數 |
| `protocol` | string | — | 通訊協定：`"acp"`（預設）或 `"copilot"` |
| `model` | string | — | 指定模型 |
| `timeoutMs` | number | — | 超時時間（預設 180,000ms；explore 模式自動加倍） |
| `maxRetries` | number | — | 重試次數 0-5（預設 0） |

#### `decisionMaker` — 決策模型

統整所有審查意見的模型，欄位同 `reviewers`。`name` 須與 reviewers 中的名稱不同，以確保 Live Output 正確顯示。

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

---

## 檢查類別

| 類別 | 說明 |
|------|------|
| `code-quality` | 命名、結構、可讀性 |
| `security` | 漏洞、認證、驗證 |
| `performance` | 算法複雜度、記憶體使用 |
| `readability` | 註解、文檔、清晰度 |
| `best-practices` | 框架慣例、設計模式 |

---

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
CONFIG_JSON='{"reviewers":[{"name":"Gemini","cliPath":"gemini","cliArgs":["--experimental-acp"]},{"name":"Copilot","cliPath":"copilot","cliArgs":[],"protocol":"copilot","model":"claude-sonnet-4.5"}],"decisionMaker":{"name":"Copilot DM","cliPath":"copilot","cliArgs":[],"protocol":"copilot","model":"gpt-5-mini"},"review":{"defaultChecks":["security"],"language":"en","mode":"explore"}}' \
  code-review-council diff --repo .
```

---

## 審查流程

```
程式碼 ──→ 並行派遣給多個 Reviewers ──→ 決策模型統整 ──→ 最終報告
              │                              │
              ├─ Gemini ────┐                │
              ├─ Copilot ───┤                │
              ├─ Codex ─────┼─→ 收集意見 ───→ Decision Maker
              └─ Claude ────┘                │
                                             ↓
                                     ┌─────────────┐
                                     │ Final Report  │
                                     │ - Decisions   │
                                     │ - Findings    │
                                     └─────────────┘
```

---

## 技術架構

- **框架**: NestJS 11 (ESM) + Angular 19
- **Monorepo**: Nx workspace
- **CLI**: nest-commander
- **Git 操作**: simple-git
- **AI 整合**: @shrek1478/copilot-sdk-with-acp (ACP / Copilot protocol)
- **測試**: Vitest
- **UI**: PrimeNG + Tailwind CSS

```
.
├── src/                              # CLI / 核心函式庫
│   ├── cli.ts                        # CLI 進入點
│   ├── constants.ts                  # 全域常數
│   ├── cli/
│   │   ├── diff.command.ts           # diff 指令
│   │   ├── file.command.ts           # file 指令
│   │   ├── codebase.command.ts       # codebase 指令
│   │   └── result-printer.ts         # 結果格式化輸出
│   ├── config/
│   │   ├── config.service.ts         # 設定載入與驗證
│   │   └── config.types.ts           # 設定型別定義
│   ├── review/
│   │   ├── council.service.ts        # 派遣多模型審查
│   │   ├── decision-maker.service.ts # 統整決策
│   │   ├── review.service.ts         # 流程編排
│   │   └── retry-utils.ts            # 重試邏輯（指數退避）
│   └── acp/
│       └── acp.service.ts            # ACP / Copilot 客戶端管理
│
├── apps/
│   ├── api/                          # Web API 後端（NestJS，port 3100）
│   │   └── src/
│   │       ├── review/
│   │       │   └── review.gateway.ts # WebSocket Gateway（審查進度推送）
│   │       ├── filesystem/           # 目錄瀏覽 / CLI 偵測 / 設定存檔
│   │       └── config/               # 設定讀取 API
│   │
│   └── web/                          # Web 前端（Angular，port 4200）
│       └── src/app/features/review/
│           ├── review-page.component.ts      # 主頁面
│           ├── review-form.component.ts      # 左側控制面板
│           ├── reviewer-selector.component.ts # CLI 選擇與手動新增
│           ├── result-viewer.component.ts    # Live Output + 結果顯示
│           └── directory-picker.component.ts # 目錄選擇器
│
└── srvctl.sh                         # 服務管理腳本（start/stop/status/logs）
```

---

## 開發

```bash
git clone https://github.com/shrek1478/code-review-council.git
cd code-review-council
npm install

# 同時啟動前後端開發伺服器
npx nx serve api   # Terminal 1 — API on http://localhost:3100
npx nx serve web   # Terminal 2 — Web on http://localhost:4200

# 執行測試
npm test

# 建置 production
npx nx run api:build
npx nx run web:build
```

## 授權

MIT
