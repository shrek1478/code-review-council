# Code Review Council - Design Document

## Summary

A NestJS application that orchestrates multiple AI models (via ACP protocol) to perform parallel code reviews, then uses Claude Code as the final summarizer to judge the reasonableness of each suggestion.

## Architecture

```
User (CLI / REST API)
        |
        v
  +-------------+
  |  Controller  |  <- REST API endpoints
  |  / CLI       |  <- Command line interface
  +------+------+
         v
  +-------------+
  | ReviewService|  <- Orchestration
  +------+------+
         |
    +----+----+
    v         v
 +------+ +-------+
 |Reader| |Council |
 +--+---+ +---+---+
    |         |  Promise.all (parallel)
    |     +---+---+
    |     v   v   v
    |   Gemini Claude Codex  <- Individual reviews
    |     +---+---+
    |         v
    |   +-----------+
    |   |Summarizer |  <- Claude Code aggregation
    |   +-----------+
    v
  Code content (git diff / files)
```

## Modules

### ConfigModule

- Reads `review-council.config.json` from project root
- Provides reviewer and summarizer configuration
- Supports runtime reload

### AcpModule

- Wraps `@github/copilot-sdk` `CopilotClient`
- Manages ACP connection lifecycle (start/stop/session)
- Factory pattern: creates client instances per reviewer config
- Handles connection errors and retries

### ReviewModule

- Core business logic
- `CodeReaderService`: reads code from git diff or file paths
- `CouncilService`: dispatches review prompts to all reviewers in parallel
- `SummarizerService`: sends all review results to Claude Code for aggregation
- `ReviewService`: orchestrates the full flow

### CliModule

- Uses `nest-commander` for CLI commands
- Subcommands: `diff`, `file`
- Options: `--repo`, `--checks`, `--extra`, `--config`

## Configuration

`review-council.config.json`:

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

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/review/diff` | Review git diff (accepts repo path or raw diff) |
| POST | `/review/file` | Review specified files |
| GET | `/review/:id` | Get review result by ID |

### POST /review/diff

```json
{
  "repoPath": "/path/to/repo",
  "baseBranch": "main",
  "checks": ["security", "performance"],
  "extraInstructions": "Check for SQL injection"
}
```

### POST /review/file

```json
{
  "files": ["src/app.ts", "src/main.ts"],
  "checks": ["code-quality"],
  "extraInstructions": ""
}
```

### Response

```json
{
  "id": "review-abc123",
  "status": "completed",
  "individualReviews": [
    { "reviewer": "Gemini", "review": "..." },
    { "reviewer": "Claude", "review": "..." },
    { "reviewer": "Codex", "review": "..." }
  ],
  "summary": {
    "reviewer": "Claude (Summarizer)",
    "aggregatedReview": "...",
    "issues": [
      {
        "severity": "high",
        "category": "security",
        "description": "...",
        "file": "src/app.ts",
        "line": 42,
        "agreedBy": ["Gemini", "Claude", "Codex"],
        "suggestion": "..."
      }
    ]
  }
}
```

## CLI Commands

```bash
# Review git diff (current branch vs main)
npx code-review-council diff --repo /path/to/repo

# Review git diff with custom base branch
npx code-review-council diff --repo /path/to/repo --base develop

# Review specified files
npx code-review-council file src/app.ts src/main.ts

# Custom checks and extra instructions
npx code-review-council diff --checks "security,performance" --extra "Check SQL injection"

# Use custom config
npx code-review-council diff --config ./my-config.json
```

## Flow

1. **Read code** - Extract code from git diff or file paths using `CodeReaderService`
2. **Build prompt** - Construct review prompt with default checks + custom instructions
3. **Parallel review** - Start all configured reviewers via `CouncilService`, each receives the same prompt + code
4. **Aggregate** - Pass all reviewer results to `SummarizerService` (Claude Code), which judges each suggestion's reasonableness and assigns priority
5. **Output** - Return structured result (console for CLI, JSON for API)

## Tech Stack

- **Framework**: NestJS (TypeScript, ESM)
- **CLI**: nest-commander
- **ACP SDK**: @github/copilot-sdk
- **Git operations**: simple-git
- **ACP backends**: gemini, claude-code-acp, codex-acp

## Project Structure

```
code-review-council/
  src/
    main.ts                    # App bootstrap
    cli.ts                     # CLI entry point
    app.module.ts
    config/
      config.module.ts
      config.service.ts
      review-council.config.json
    acp/
      acp.module.ts
      acp.service.ts           # CopilotClient factory
    review/
      review.module.ts
      review.controller.ts     # REST API
      review.service.ts        # Orchestration
      code-reader.service.ts   # Git diff / file reader
      council.service.ts       # Parallel review dispatch
      summarizer.service.ts    # Claude Code aggregation
    cli/
      cli.module.ts
      diff.command.ts
      file.command.ts
  review-council.config.json   # Default config
  package.json
  tsconfig.json
  nest-cli.json
```
