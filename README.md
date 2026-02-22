# Code Review Council

多模型 AI Code Review 工具，同時派遣多個 AI CLI（Gemini、Copilot、Codex、Claude 等）審查程式碼，再由決策模型統整所有意見，產出完整的 review 報告。

提供兩種使用方式：**Web 介面**（圖形化操作，含即時串流輸出）與 **CLI**（終端機指令）。

## 功能

- **diff** — 審查 git 分支差異（適合 PR review）
- **file** — 審查指定檔案
- **codebase** — 掃描整個專案目錄，自動分批送審

### 審查模式（Analysis Mode）

| 模式 | 說明 |
|------|------|
| **Inline** | 直接將程式碼內嵌於 prompt 送出 |
| **Batch** | 程式碼分批分段送出，每批各自審查後合併 |
| **Explore** | 僅傳送檔案路徑，由 AI agent 自行讀取並探索 codebase |

### Web 介面特有功能

- 自動偵測已安裝的 CLI 工具，勾選即可啟用
- 手動新增 CLI 項目（同一 CLI 可同時擔任 Reviewer 與 Decision Maker）
- 即時 Live Output：各審查員進度與串流回應同步顯示
- Final Decision 整合報告，含 accepted / rejected / modified 決策表格
- 一鍵下載結果（JSON / Markdown）
- Config Editor：在瀏覽器內直接編輯、驗證並儲存設定檔

---

## 前置需求

- Node.js >= 20
- 至少一個已安裝的 AI CLI 工具：

| 工具 | 安裝方式 | Protocol |
|------|---------|----------|
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` | ACP |
| [GitHub Copilot CLI](https://github.com/github/copilot-cli) | `npm install -g @github/copilot` | Copilot |
| [Codex CLI](https://github.com/openai/codex) | `npm install -g @openai/codex` | ACP |
| [Claude Code ACP](https://github.com/zed-industries/claude-code-acp) | `npm install -g @zed-industries/claude-code-acp` | ACP |

> Copilot CLI 使用原生 Copilot SDK protocol，設定 `"protocol": "copilot"` 啟用，其餘 CLI 預設使用 ACP protocol。

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

使用 `srvctl.sh` 管理前後端服務：

```bash
./srvctl.sh start        # 啟動 API（port 3100）+ Web（port 4200）
./srvctl.sh status       # 查看服務狀態
./srvctl.sh logs         # 即時追蹤所有 log
./srvctl.sh logs api     # 只看 API log
./srvctl.sh logs web     # 只看 Web log
./srvctl.sh stop         # 停止所有服務
./srvctl.sh restart      # 重啟
./srvctl.sh build-start  # 重新建置 API 後再啟動
```

### 3. 開啟瀏覽器

前往 [http://localhost:4200](http://localhost:4200)

### Web 介面操作說明

```
┌─────────────────────────────────────┬──────────────────────────────────────┐
│           左側控制面板               │           右側輸出區域                │
├─────────────────────────────────────┤                                      │
│ Mode:    Inline | Batch | Explore   │  審查進行中 Live Output：             │
│ Review:  Codebase | Diff | File     │  ┌── Gemini ──── ● Waiting...        │
│                                     │  ├── Copilot ─── ✓ Done              │
│ Directory / Repo Path / File Paths  │  └── Codex ───── ✓ Done              │
│ Base Branch（Diff 模式）             │                                      │
│                                     │  Decision Maker is reviewing...       │
│ Extra Instructions（選填）          │  ┌── Copilot DM ─ ● Waiting...       │
│                                     │                                      │
│ CLIS:                               │  審查完成後：                         │
│  ☑ Gemini     [Installed]           │  Individual Reviews（可展開）         │
│  ☑ Copilot    [Installed]           │  Final Decision                      │
│     Role: Reviewer  Model: ...      │  - Decisions 決策表格                 │
│  ☐ Codex      [Installed]           │  - Additional Findings               │
│  ☐ Claude     [Installed]           │  下載 JSON / Markdown                │
│  ☑ Copilot DM [Installed] ×         │                                      │
│     Role: Decision Maker            │  錯誤訊息（若有）                     │
│  ＋ Add CLI                         │                                      │
├─────────────────────────────────────┤                                      │
│        [ Start Review ]             │                                      │
└─────────────────────────────────────┴──────────────────────────────────────┘
```

**CLIS 區塊說明：**
- 自動偵測已安裝的 CLI，勾選即啟用
- 每個 CLI 可設定角色：**Reviewer**（負責審查）或 **Decision Maker**（統整決策）
- `copilot` protocol 的 CLI 可額外選擇模型
- 點擊「**＋ Add CLI**」手動新增，支援同一 CLI 以不同名稱同時擔任 Reviewer 和 Decision Maker
- 手動新增的項目右側有 **×** 按鈕可刪除；重複名稱會自動加上流水號（如 `Copilot (2)`）

---

## 快速開始：CLI

### 1. 全域安裝

```bash
# 設定 GitHub Packages registry
echo "@shrek1478:registry=https://npm.pkg.github.com" >> ~/.npmrc

# 全域安裝
npm install -g @shrek1478/code-review-council
```

### 2. 建立設定檔

```bash
mkdir -p ~/.code-review-council
```

建立 `~/.code-review-council/review-council.config.json`：

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

> **重要**：當同一 CLI（如 `copilot`）同時擔任 Reviewer 與 Decision Maker 時，`name` 欄位必須不同（如 `"Copilot"` 與 `"Copilot DM"`），以確保 Live Output 進度追蹤正常運作。

### 3. 執行審查

```bash
# 審查當前分支與 main 的差異
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
| `--batch-size <chars>` | 每批最大字元數 | 500,000 |
| `--checks <list>` | 檢查類別 | — |
| `--extra <text>` | 額外審查指示 | — |
| `--config <path>` | 設定檔路徑 | — |

---

## 設定檔

### 載入優先順序

1. `--config <path>` — CLI 指定的路徑
2. `CONFIG_JSON` 環境變數 — JSON 字串形式的完整設定
3. `~/.code-review-council/review-council.config.json` — 使用者家目錄（推薦）
4. `./review-council.config.json` — 當前工作目錄（專案層級）
5. 內建預設設定

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
    "mode": "explore",
    "maxReviewsLength": 60000,
    "maxCodeLength": 100000,
    "maxSummaryLength": 60000,
    "extensions": [".ts", ".js", ".py", ".go"],
    "excludePatterns": ["**/*.spec.ts", "**/node_modules/**"],
    "sensitivePatterns": ["^\\.env", "\\.key$"]
  }
}
```

### 設定欄位說明

#### `reviewers[]` / `decisionMaker` — 審查器設定

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `name` | string | ✓ | 審查器名稱（同 cliPath 多角色時須唯一） |
| `cliPath` | string | ✓ | CLI 命令名稱（如 `gemini`、`copilot`） |
| `cliArgs` | string[] | ✓ | CLI 啟動參數 |
| `protocol` | string | — | `"acp"`（預設）或 `"copilot"` |
| `model` | string | — | 指定模型（Copilot protocol 有效） |
| `timeoutMs` | number | — | 超時毫秒數（預設 180,000；explore 模式自動加倍） |
| `maxRetries` | number | — | 重試次數 0–5（預設 0） |
| `streaming` | boolean | — | 是否啟用串流回應（預設 false） |

#### `review` — 審查行為設定

| 欄位 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| `defaultChecks` | string[] | — | 預設檢查類別 |
| `language` | string | `"zh-tw"` | 輸出語言 |
| `mode` | string | `"inline"` | `"inline"` / `"batch"` / `"explore"` |
| `maxReviewsLength` | number | 60,000 | 各審查員結果最大字元數 |
| `maxCodeLength` | number | 100,000 | 程式碼最大字元數（超過則截斷） |
| `maxSummaryLength` | number | 60,000 | 摘要最大字元數 |
| `extensions` | string[] | 常見副檔名 | codebase 模式掃描的副檔名 |
| `excludePatterns` | string[] | 測試/lock 等 | 排除的 glob 模式（如 `**/*.spec.ts`） |
| `sensitivePatterns` | string[] | — | 敏感檔案的 regex 模式（匹配則排除） |

### 環境變數覆蓋

| 環境變數 | 說明 |
|---------|------|
| `CONFIG_JSON` | JSON 字串形式的完整設定（覆蓋設定檔） |
| `DECISION_MAKER_MODEL` | 覆蓋決策模型名稱 |
| `REVIEW_LANGUAGE` | 覆蓋審查語言 |
| `DECISION_MAKER_TIMEOUT_MS` | 覆蓋決策模型超時 |
| `REVIEWER_TIMEOUT_MS` | 覆蓋所有審查器超時 |
| `REVIEWER_EXPLORE_LOCAL` | 覆蓋審查模式（`true` → explore，`false` → inline） |
| `API_PORT` | API 伺服器埠號（預設 3100） |
| `WEB_PORT` | Web 伺服器埠號（預設 4200） |

---

## 檢查類別

| 類別 | 說明 |
|------|------|
| `code-quality` | 命名、結構、可維護性 |
| `security` | 漏洞、認證、輸入驗證 |
| `performance` | 算法複雜度、記憶體使用 |
| `readability` | 註解、文件、程式碼清晰度 |
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
CONFIG_JSON='{"reviewers":[{"name":"Gemini","cliPath":"gemini","cliArgs":["--experimental-acp"]}],"decisionMaker":{"name":"Copilot DM","cliPath":"copilot","cliArgs":[],"protocol":"copilot","model":"gpt-5-mini"},"review":{"defaultChecks":["security"],"language":"en","mode":"explore"}}' \
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
                                     ┌───────────────┐
                                     │  Final Report  │
                                     │  - Decisions   │
                                     │  - Findings    │
                                     └───────────────┘
```

**最大限制（預設值）：**
- 單一檔案大小：1 MB
- 總程式碼大小：200 MB
- Diff 最大大小：5 MB
- 每批最大字元數：500,000
- 並行審查員數：5
- 並行批次數：2

---

## 技術架構

- **框架**：NestJS 11 (ESM) + Angular 21
- **Monorepo**：Nx 22
- **CLI**：nest-commander
- **Git 操作**：simple-git
- **AI 整合**：@shrek1478/copilot-sdk-with-acp（ACP / Copilot protocol）
- **測試**：Vitest
- **UI**：PrimeNG + Tailwind CSS

```
.
├── src/                                    # 核心函式庫（CLI 共用）
│   ├── cli.ts                              # CLI 進入點
│   ├── constants.ts                        # 全域常數與限制值
│   ├── cli/
│   │   ├── diff.command.ts                 # diff 指令
│   │   ├── file.command.ts                 # file 指令
│   │   ├── codebase.command.ts             # codebase 指令
│   │   └── result-printer.ts              # 終端機輸出格式化
│   ├── config/
│   │   ├── config.service.ts              # 設定載入與驗證
│   │   └── config.types.ts                # ReviewerConfig / CouncilConfig 型別
│   ├── review/
│   │   ├── review.service.ts              # 流程編排（diff / file / codebase）
│   │   ├── code-reader.service.ts         # 讀取 diff / 檔案 / 目錄
│   │   ├── council.service.ts             # 並行派遣多模型審查
│   │   ├── decision-maker.service.ts      # 統整決策與結構化輸出
│   │   └── retry-utils.ts                 # 指數退避重試
│   └── acp/
│       └── acp.service.ts                 # ACP / Copilot 客戶端管理
│
├── apps/
│   ├── api/                               # Web API 後端（NestJS，port 3100）
│   │   └── src/
│   │       ├── app.module.ts
│   │       ├── review/
│   │       │   └── review.gateway.ts      # WebSocket Gateway（審查啟動 & 進度推送）
│   │       ├── filesystem/
│   │       │   └── filesystem.controller.ts  # 目錄瀏覽、CLI 偵測、設定存檔
│   │       └── config/
│   │           └── config.controller.ts   # 設定讀取 & 驗證 API
│   │
│   └── web/                               # Web 前端（Angular，port 4200）
│       └── src/app/
│           ├── core/services/
│           │   ├── review-store.service.ts  # Signal-based 全域狀態
│           │   └── api.service.ts           # HTTP / WebSocket API 客戶端
│           └── features/
│               ├── review/
│               │   ├── review-page.component.ts       # 主頁面佈局
│               │   ├── review-form.component.ts       # 左側輸入面板
│               │   ├── reviewer-selector.component.ts # CLI 選擇、角色設定、手動新增
│               │   ├── result-viewer.component.ts     # Live Output + 結果顯示
│               │   ├── decision-table.component.ts    # 決策表格
│               │   ├── directory-picker.component.ts  # 目錄瀏覽器
│               │   └── progress-tracker.component.ts  # 審查進度追蹤
│               └── config/
│                   └── config-editor.component.ts     # 瀏覽器內 JSON 設定編輯器
│
└── srvctl.sh                              # 服務管理腳本（start/stop/status/logs/restart）
```

---

## 開發

```bash
git clone https://github.com/shrek1478/code-review-council.git
cd code-review-council
npm install

# 開發模式：分別啟動前後端
npx nx serve api   # Terminal 1 — API on http://localhost:3100
npx nx serve web   # Terminal 2 — Web on http://localhost:4200

# 執行測試
npm test

# 建置 production
npx nx run api:build
npx nx run web:build
./srvctl.sh start
```

## 授權

MIT
