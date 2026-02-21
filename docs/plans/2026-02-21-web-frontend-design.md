# Code Review Council Web Frontend Design

## Summary

Add a web-based frontend to the existing CLI tool, enabling users to configure, execute, and view code reviews through a browser UI. Uses Nx monorepo to coexist with the existing CLI.

## Decisions

- **Monorepo**: Nx (native Angular + NestJS support, shared libs, build cache)
- **Backend**: NestJS HTTP server, reusing existing review/config/acp services
- **Frontend**: Angular 21 (Signal-based), PrimeNG, Tailwind CSS
- **Real-time**: SSE (Server-Sent Events) for review progress
- **Persistence**: None (session-only, user can download results)
- **Auth**: None (internal tool)
- **API reference**: All endpoints defined in `/api-reference.json`

## Architecture

### Monorepo Structure

```
code-review-council/
├── apps/
│   ├── api/                          # NestJS HTTP + SSE server
│   │   └── src/
│   │       ├── main.ts               # bootstrap (port 3100)
│   │       ├── app.module.ts         # imports review/config/acp modules
│   │       ├── review/
│   │       │   ├── review.controller.ts   # REST + SSE endpoints
│   │       │   └── review-sse.service.ts  # SSE event management
│   │       └── config/
│   │           └── config.controller.ts   # config CRUD
│   └── web/                          # Angular 21 + PrimeNG + Tailwind
│       └── src/
│           └── app/
│               ├── app.component.ts
│               ├── app.routes.ts
│               ├── core/             # services, interceptors
│               ├── features/
│               │   ├── review/       # review page
│               │   └── config/       # config editor
│               └── shared/           # shared components
├── libs/
│   └── shared/                       # shared types & constants
│       └── src/types/
├── src/                              # existing CLI (untouched)
├── api-reference.json                # API endpoint definitions
└── nx.json
```

### Key Principle

`apps/api` controllers are thin HTTP layers. All business logic reuses existing services from `src/review/`, `src/config/`, and `src/acp/`.

## API Design

### Review Endpoints (SSE)

All three review endpoints return SSE streams with progress events followed by a final result event.

#### `POST /api/reviews/diff`

Request:
```json
{
  "repoPath": "/path/to/repo",
  "baseBranch": "main",
  "checks": ["security", "code-quality"],
  "extra": "Focus on authentication",
  "config": { "reviewers": [...], "decisionMaker": {...}, "review": {...} }
}
```

#### `POST /api/reviews/file`

Request:
```json
{
  "filePaths": ["src/app.ts", "src/main.ts"],
  "checks": ["security"],
  "extra": "",
  "config": { ... }
}
```

#### `POST /api/reviews/codebase`

Request:
```json
{
  "directory": "/path/to/project",
  "extensions": ["ts", "js"],
  "batchSize": 100000,
  "checks": ["code-quality", "security"],
  "extra": "",
  "config": { ... }
}
```

### SSE Event Stream

```
event: progress
data: {"reviewer":"Gemini","status":"sending","timestamp":"2026-02-21T12:00:00Z"}

event: progress
data: {"reviewer":"Gemini","status":"done","durationMs":30600}

event: progress
data: {"reviewer":"Copilot","status":"error","error":"timeout"}

event: dm-progress
data: {"status":"sending"}

event: result
data: { ...full ReviewResult JSON... }
```

### Config Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Get current effective config |
| `POST` | `/api/config/validate` | Validate config JSON |
| `GET` | `/api/config/models` | List available models |

## Frontend Design

### Tech Stack

- Angular 21 with Signal-based state management (no NgRx/RxJS stores)
- PrimeNG for UI components
- Tailwind CSS for layout and utility styling

### Page Layout

Single-page application with two-panel layout:

```
+------------------------+--------------------------------------+
| Left Panel (Config)    | Right Panel (Results)                |
|                        |                                      |
| Review Mode selector   | Progress cards (per reviewer)        |
| Path/branch inputs     | Individual Reviews (accordion)       |
| Config editor/loader   | Final Decision (table)               |
| Reviewer checkboxes    | Download buttons                     |
| Model dropdowns        |                                      |
| [Start Review] button  |                                      |
+------------------------+--------------------------------------+
```

### Component Tree

```
features/
├── review/
│   ├── review-page.component.ts       # main page (two-panel)
│   ├── review-form.component.ts       # left: mode + params
│   ├── reviewer-selector.component.ts # reviewer/DM model dropdowns
│   ├── progress-tracker.component.ts  # SSE progress cards
│   ├── result-viewer.component.ts     # result display
│   └── decision-table.component.ts    # decisions markdown table
├── config/
│   ├── config-editor.component.ts     # JSON editor
│   └── config-preset.component.ts     # preset config selector
└── shared/
    ├── api.service.ts                 # HTTP + SSE communication
    └── review-store.service.ts        # Signal-based state
```

### Signal State Management

```typescript
@Injectable({ providedIn: 'root' })
export class ReviewStore {
  readonly config = signal<CouncilConfig | null>(null);
  readonly reviewMode = signal<'diff' | 'file' | 'codebase'>('codebase');
  readonly isReviewing = signal(false);
  readonly progress = signal<Map<string, ProgressEvent>>(new Map());
  readonly result = signal<ReviewResult | null>(null);

  readonly allReviewersDone = computed(() =>
    [...this.progress().values()].every(p => p.status !== 'sending')
  );
}
```

### PrimeNG Component Mapping

| UI Element | PrimeNG Component |
|------------|-------------------|
| Mode selector | `p-selectButton` |
| Reviewer checkboxes | `p-checkbox` |
| Model dropdowns | `p-dropdown` |
| Progress cards | `p-card` + `p-progressSpinner` |
| Reviews accordion | `p-accordion` |
| Decision table | `p-table` |
| Config editor | `p-textarea` |
| Download buttons | `p-splitButton` |
| Start button | `p-button` |

### Download Formats

- **JSON**: Raw `ReviewResult` object
- **Markdown**: Formatted report with decisions table

## Data Flow

```
User clicks [Start Review]
  → Angular sends POST /api/reviews/codebase (with config override)
  → NestJS controller creates SSE stream
  → ReviewService dispatches to reviewers
  → Each reviewer status change → SSE progress event → Angular updates progress cards
  → All reviews done → DecisionMakerService.decide()
  → DM progress → SSE dm-progress event
  → Final result → SSE result event → Angular displays full result
```

## Error Handling

- **Reviewer timeout/failure**: SSE sends error progress event, UI shows failed card, review continues with remaining reviewers
- **All reviewers failed**: SSE sends result with `status: 'failed'`, UI shows error state
- **SSE connection lost**: Frontend auto-reconnects or shows reconnect button
- **Invalid config**: `/api/config/validate` returns validation errors, UI shows inline errors

## Out of Scope

- Authentication/authorization
- Review history persistence
- GitHub/GitLab integration
- Multi-user support
- Deployment/containerization
