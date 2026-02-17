# Docker Containerization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 將 code-review-council 打包為 multi-stage Docker image，支援 CLI 模式運行，透過 docker-compose 管理。

**Architecture:** 兩階段 Docker build — Stage 1 編譯 TypeScript，Stage 2 只保留 dist + production deps + runtime 工具（git, AI CLIs）。Build context 設在上層目錄以包含 local file dependency `@github/copilot-sdk`。

**Tech Stack:** Docker, docker-compose, Node.js 22 slim, NestJS CLI build

---

### Task 1: Create .dockerignore

**Files:**
- Create: `code-review-council/.dockerignore`

**Step 1: Create .dockerignore file**

```dockerignore
# Dependencies
node_modules

# Build output (rebuilt in Docker)
dist

# IDE
.idea
*.sw?
.DS_Store

# Env files (secrets should not be in image)
.env
.env.*

# Debug logs
npm-debug.log*

# Test & coverage
coverage
**/*.spec.ts
vitest.config.ts

# Docs & config
docs
.git
.gitignore
.prettierrc
eslint.config.mjs
README.md

# Docker files (avoid recursive context)
Dockerfile
docker-compose.yml
```

**Step 2: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .dockerignore for Docker build"
```

---

### Task 2: Create Dockerfile

**Files:**
- Create: `code-review-council/Dockerfile`

**Context:**
- Build context 是上層目錄（`/Users/he6463/Hepiuscare/sample/`），所以路徑以 `code-review-council/` 和 `copilot-sdk-acp/` 開頭
- `@github/copilot-sdk` 在 `package.json` 中指向 `file:../copilot-sdk-acp/copilot-sdk/nodejs`
- Docker 中需要調整這個路徑，讓它指向容器內的 `/app/copilot-sdk`
- `nest build` 需要 `@nestjs/cli` (devDependency)

**Step 1: Create Dockerfile**

```dockerfile
# ============================================
# Stage 1: Build
# ============================================
FROM node:22-slim AS build

WORKDIR /app

# Copy copilot-sdk local dependency
COPY copilot-sdk-acp/copilot-sdk/nodejs /app/copilot-sdk

# Copy package files and adjust local dependency path
COPY code-review-council/package.json code-review-council/package-lock.json ./

# Rewrite local dep path: ../copilot-sdk-acp/copilot-sdk/nodejs → ./copilot-sdk
RUN sed -i 's|file:../copilot-sdk-acp/copilot-sdk/nodejs|file:./copilot-sdk|g' package.json

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and build config
COPY code-review-council/src ./src
COPY code-review-council/tsconfig.json code-review-council/tsconfig.build.json code-review-council/nest-cli.json ./

# Build TypeScript
RUN npx nest build

# ============================================
# Stage 2: Production
# ============================================
FROM node:22-slim AS production

# Install git (required by simple-git at runtime)
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Install AI CLI tools globally
# NOTE: Verify actual npm package names before building.
#       These are placeholder names - update to match real packages.
# RUN npm install -g @anthropic-ai/claude-code \
#     && npm install -g @google/gemini-cli \
#     && npm install -g @github/copilot-cli

WORKDIR /app

# Copy copilot-sdk local dependency
COPY copilot-sdk-acp/copilot-sdk/nodejs /app/copilot-sdk

# Copy package files and adjust local dependency path
COPY code-review-council/package.json code-review-council/package-lock.json ./
RUN sed -i 's|file:../copilot-sdk-acp/copilot-sdk/nodejs|file:./copilot-sdk|g' package.json

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built output from build stage
COPY --from=build /app/dist ./dist

# Copy default config (can be overridden by volume mount or CONFIG_JSON env var)
COPY code-review-council/review-council.config.json ./review-council.config.json

# Use non-root user for security
USER node

ENTRYPOINT ["node", "dist/cli.js"]
```

**Step 2: Verify Dockerfile syntax**

Run: `docker build --check -f code-review-council/Dockerfile .` (from parent directory)
or just verify the file was written correctly by reading it back.

**Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: add multi-stage Dockerfile for containerization"
```

---

### Task 3: Create docker-compose.yml

**Files:**
- Create: `code-review-council/docker-compose.yml`

**Context:**
- `context` 需指向上層目錄以包含 copilot-sdk
- `dockerfile` 相對於 context 指向本專案的 Dockerfile
- CLI 模式 — 使用者透過 `docker compose run` 傳入指令
- 需要掛載目標 git repo 供 review

**Step 1: Create docker-compose.yml**

```yaml
services:
  code-review-council:
    build:
      context: ..
      dockerfile: code-review-council/Dockerfile
    # Override config via volume mount (optional, can also use CONFIG_JSON env var)
    volumes:
      - ./review-council.config.json:/app/review-council.config.json:ro
    environment:
      # Uncomment and set your API keys:
      # GEMINI_API_KEY: ${GEMINI_API_KEY}
      # GITHUB_TOKEN: ${GITHUB_TOKEN}
      # ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      #
      # Optional overrides:
      # CONFIG_JSON: '{"reviewers": [...], ...}'
      # DECISION_MAKER_MODEL: claude-sonnet-4-5-20250929
      # REVIEW_LANGUAGE: zh-tw
      # REVIEWER_TIMEOUT_MS: "120000"
      NODE_ENV: production
```

**Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose.yml for simplified build and run"
```

---

### Task 4: Test Docker Build

**Step 1: Build the image**

Run (from `code-review-council/` directory):
```bash
docker compose build
```

Expected: Image builds successfully through both stages.

**Step 2: Verify image contents**

Run:
```bash
docker compose run --rm --entrypoint sh code-review-council -c "ls -la dist/ && node --version && git --version"
```

Expected: `dist/` contains compiled JS files, Node v22.x, git installed.

**Step 3: Test CLI help**

Run:
```bash
docker compose run --rm code-review-council --help
```

Expected: Shows CLI help output with available commands (diff, file, codebase).

**Step 4: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: adjust Docker build configuration"
```

---

### Task 5: Verify and Final Commit

**Step 1: Run full build from clean state**

```bash
docker compose build --no-cache
```

Expected: Clean build succeeds.

**Step 2: Verify image size**

```bash
docker images | grep code-review-council
```

Expected: Image size ~300-500MB (without AI CLIs), reasonable for a Node.js app.

**Step 3: Final commit (if not already committed)**

```bash
git status
# If there are uncommitted changes:
git add .dockerignore Dockerfile docker-compose.yml
git commit -m "feat: Docker containerization with multi-stage build"
```

---

## Notes

### AI CLI Tools

The AI CLI tool installation lines in the Dockerfile are commented out because the exact npm package names need to be verified. The user should:

1. Confirm the correct npm package names for `gemini`, `copilot`, and `claude-code-acp`
2. Uncomment and update the `RUN npm install -g ...` section in the Dockerfile
3. Rebuild the image

### Running Reviews

```bash
# Review git diff (mount target repo)
docker compose run --rm -v /path/to/repo:/repo:ro code-review-council diff

# Review specific files
docker compose run --rm -v /path/to/repo:/repo:ro code-review-council file --files /repo/src/app.ts

# Review codebase
docker compose run --rm -v /path/to/repo:/repo:ro code-review-council codebase --path /repo
```

### Passing API Keys

Create a `.env` file (already in `.gitignore`):

```env
GEMINI_API_KEY=your-key
GITHUB_TOKEN=your-token
ANTHROPIC_API_KEY=your-key
```

Then update `docker-compose.yml` to use `env_file: .env`.
