# Docker Containerization Design

## Date: 2026-02-17

## Goal

將 code-review-council 專案打包為 Docker image，以 CLI 模式運行，使用 docker-compose 在單機部署。

## Architecture

### Multi-stage Build

兩階段構建：build stage 編譯 TypeScript，production stage 只保留 runtime 所需檔案。

```
Stage 1: build (node:22-slim)
  → 安裝所有依賴（含 devDeps）
  → 編譯 TypeScript → dist/

Stage 2: production (node:22-slim)
  → 安裝 git + AI CLI 工具
  → 只安裝 production dependencies
  → 複製 dist/ from build stage
  → ENTRYPOINT: node dist/cli.js
```

### Build Context

由於 `@github/copilot-sdk` 是 local file dependency（`file:../copilot-sdk-acp/copilot-sdk/nodejs`），build context 設在上層目錄：

```
docker-compose.yml context: ..
dockerfile: code-review-council/Dockerfile
```

### Files to Create

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build definition |
| `.dockerignore` | Exclude unnecessary files |
| `docker-compose.yml` | Simplify build & run commands |

## Key Decisions

1. **Base image**: `node:22-slim` — 支援 ES2023 + ESM，slim 減少體積
2. **AI CLI 安裝**: 在 production stage 全域安裝 gemini、copilot、claude-code-acp
3. **Local dependency**: copilot-sdk 透過擴大 build context 解決
4. **Configuration**: 透過 volume mount `review-council.config.json` 或 `CONFIG_JSON` env var
5. **Security**: 使用 `node` user 運行，不含原始碼
6. **Git**: production stage 安裝 git（simple-git runtime 需要）

## Runtime

```bash
# Build
docker compose build

# Run (review git diff)
docker compose run --rm code-review-council diff

# Run (review files)
docker compose run --rm code-review-council file --files src/app.ts

# Run (review codebase)
docker compose run --rm code-review-council codebase
```

## Authentication

所有 AI CLI 工具（gemini、copilot、claude-code-acp）的認證由 CLI 本身管理，專案不處理 API key。認證方式：

- **預設**: CLI 工具使用 stored OAuth token（`useLoggedInUser: true`）
- **可選**: 透過 `COPILOT_SDK_AUTH_TOKEN` 環境變數傳入 GitHub token
- **Docker 方案**: 掛載 host 的 auth credentials 目錄（如 `~/.config/`）到容器內

## Environment Variables

- `CONFIG_JSON` — 完整設定 JSON 字串（可替代設定檔）
- `DECISION_MAKER_MODEL` — 覆蓋 decision maker model
- `REVIEW_LANGUAGE` — 覆蓋 review 語言
- `REVIEWER_TIMEOUT_MS` — 覆蓋 reviewer timeout
- `COPILOT_SDK_AUTH_TOKEN` — 可選，GitHub token（覆蓋 stored OAuth）
