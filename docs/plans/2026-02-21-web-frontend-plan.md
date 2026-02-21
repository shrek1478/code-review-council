# Web Frontend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a web UI to the existing CLI tool, enabling browser-based code review with real-time SSE progress.

**Architecture:** Nx monorepo with `apps/api` (NestJS HTTP+SSE), `apps/web` (Angular 21+PrimeNG+Tailwind), and `libs/shared` (shared types). Existing CLI in `src/` remains untouched. The API layer is thin — it delegates to existing review/config/acp services.

**Tech Stack:** Nx 22.5+, Angular 21, PrimeNG 21, Tailwind CSS v4, NestJS 11, SSE

**Design doc:** `docs/plans/2026-02-21-web-frontend-design.md`

---

## Task 1: Initialize Nx Monorepo

Convert the existing project to an Nx workspace while preserving the CLI build.

**Files:**
- Create: `nx.json`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Step 1: Install Nx**

```bash
npm install -D nx @nx/workspace
```

**Step 2: Initialize Nx configuration**

Create `nx.json`:

```json
{
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "defaultBase": "main",
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "sharedGlobals": []
  },
  "targetDefaults": {
    "build": { "dependsOn": ["^build"], "cache": true },
    "test": { "cache": true }
  }
}
```

**Step 3: Add workspace tsconfig paths**

Add to `tsconfig.json` compilerOptions:

```json
"paths": {
  "@code-review-council/shared": ["libs/shared/src/index.ts"]
}
```

**Step 4: Verify existing CLI still builds**

Run: `npm run build`
Expected: Successful build, `dist/` output unchanged

**Step 5: Commit**

```bash
git add nx.json package.json package-lock.json tsconfig.json
git commit -m "chore: initialize Nx monorepo"
```

---

## Task 2: Create Shared Types Library

Extract shared types from `src/` into `libs/shared/` for use by both API and web apps.

**Files:**
- Create: `libs/shared/src/index.ts`
- Create: `libs/shared/src/types/review.types.ts`
- Create: `libs/shared/src/types/config.types.ts`
- Create: `libs/shared/src/types/sse.types.ts`
- Create: `libs/shared/tsconfig.json`
- Create: `libs/shared/project.json`

**Step 1: Create directory structure**

```bash
mkdir -p libs/shared/src/types
```

**Step 2: Create review types**

`libs/shared/src/types/review.types.ts` — Copy the exact interfaces from `src/review/review.types.ts`:

```typescript
export interface IndividualReview {
  reviewer: string;
  review: string;
  status: 'success' | 'error';
  durationMs?: number;
}

export type ReviewCategory =
  | 'security'
  | 'performance'
  | 'readability'
  | 'code-quality'
  | 'best-practices'
  | 'other';

export interface ReviewDecisionItem {
  severity: 'high' | 'medium' | 'low';
  category: ReviewCategory;
  description: string;
  file?: string;
  line?: number;
  raisedBy: string[];
  verdict: 'accepted' | 'rejected' | 'modified';
  reasoning: string;
  suggestion: string;
}

export interface AdditionalFinding {
  severity: 'high' | 'medium' | 'low';
  category: ReviewCategory;
  description: string;
  file?: string;
  suggestion: string;
}

export interface ReviewDecision {
  reviewer: string;
  overallAssessment: string;
  decisions: ReviewDecisionItem[];
  additionalFindings: AdditionalFinding[];
  parseFailed?: boolean;
}

export interface ReviewResult {
  id: string;
  status: 'completed' | 'failed' | 'partial';
  individualReviews: IndividualReview[];
  decision?: ReviewDecision;
  durationMs?: number;
}
```

**Step 3: Create config types**

`libs/shared/src/types/config.types.ts` — Copy from `src/config/config.types.ts`:

```typescript
export interface ReviewerConfig {
  name: string;
  cliPath: string;
  cliArgs: string[];
  protocol?: 'acp' | 'copilot';
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ReviewConfig {
  defaultChecks: string[];
  language: string;
  maxReviewsLength?: number;
  maxCodeLength?: number;
  maxSummaryLength?: number;
  mode?: 'inline' | 'explore';
  extensions?: string[];
  sensitivePatterns?: string[];
}

export interface CouncilConfig {
  reviewers: ReviewerConfig[];
  decisionMaker: ReviewerConfig;
  review: ReviewConfig;
}
```

**Step 4: Create SSE event types**

`libs/shared/src/types/sse.types.ts`:

```typescript
export interface ReviewProgressEvent {
  reviewer: string;
  status: 'sending' | 'done' | 'error';
  durationMs?: number;
  error?: string;
  timestamp: string;
}

export interface DmProgressEvent {
  status: 'sending' | 'done';
  timestamp: string;
}

export interface ReviewStartedResponse {
  reviewId: string;
}
```

**Step 5: Create barrel export**

`libs/shared/src/index.ts`:

```typescript
export * from './types/review.types.js';
export * from './types/config.types.js';
export * from './types/sse.types.js';
```

**Step 6: Create tsconfig and project.json**

`libs/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/libs/shared",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

`libs/shared/project.json`:

```json
{
  "name": "shared",
  "sourceRoot": "libs/shared/src",
  "projectType": "library",
  "tags": ["scope:shared"]
}
```

**Step 7: Commit**

```bash
git add libs/shared/
git commit -m "feat: create shared types library"
```

---

## Task 3: Create NestJS API App

Scaffold the API app that exposes HTTP+SSE endpoints, reusing existing review services.

**Files:**
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/review/review.controller.ts`
- Create: `apps/api/src/review/review-sse.service.ts`
- Create: `apps/api/src/review/review-api.module.ts`
- Create: `apps/api/src/config/config.controller.ts`
- Create: `apps/api/src/config/config-api.module.ts`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/project.json`

**Step 1: Install API dependencies**

```bash
npm install @nestjs/platform-express @nestjs/event-emitter
```

**Step 2: Create directory structure**

```bash
mkdir -p apps/api/src/review apps/api/src/config
```

**Step 3: Create `apps/api/src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  await app.listen(3100);
  console.log(`API server running on http://localhost:3100`);
}
bootstrap();
```

**Step 4: Create `apps/api/src/review/review-sse.service.ts`**

This service manages SSE event streams per review job:

```typescript
import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { map, finalize } from 'rxjs/operators';
import { MessageEvent } from '@nestjs/common';

interface SseEvent {
  type: string;
  data: unknown;
}

@Injectable()
export class ReviewSseService {
  private readonly streams = new Map<string, Subject<SseEvent>>();

  createStream(reviewId: string): void {
    this.streams.set(reviewId, new Subject<SseEvent>());
  }

  emit(reviewId: string, type: string, data: unknown): void {
    const subject = this.streams.get(reviewId);
    if (subject) {
      subject.next({ type, data });
    }
  }

  complete(reviewId: string): void {
    const subject = this.streams.get(reviewId);
    if (subject) {
      subject.complete();
      this.streams.delete(reviewId);
    }
  }

  getStream(reviewId: string): Observable<MessageEvent> | null {
    const subject = this.streams.get(reviewId);
    if (!subject) return null;
    return subject.asObservable().pipe(
      map(
        (event): MessageEvent => ({
          type: event.type,
          data: JSON.stringify(event.data),
        }),
      ),
      finalize(() => this.streams.delete(reviewId)),
    );
  }
}
```

**Step 5: Create `apps/api/src/review/review.controller.ts`**

```typescript
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Sse,
  NotFoundException,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { ReviewService } from '../../../../src/review/review.service.js';
import { ConfigService } from '../../../../src/config/config.service.js';
import { ReviewSseService } from './review-sse.service.js';

interface ReviewDiffBody {
  repoPath: string;
  baseBranch?: string;
  checks?: string[];
  extra?: string;
  config?: Record<string, unknown>;
}

interface ReviewFileBody {
  filePaths: string[];
  checks?: string[];
  extra?: string;
  config?: Record<string, unknown>;
}

interface ReviewCodebaseBody {
  directory: string;
  extensions?: string[];
  batchSize?: number;
  checks?: string[];
  extra?: string;
  config?: Record<string, unknown>;
}

@Controller('reviews')
export class ReviewController {
  constructor(
    private readonly reviewService: ReviewService,
    private readonly configService: ConfigService,
    private readonly sseService: ReviewSseService,
  ) {}

  @Post('diff')
  async startDiffReview(@Body() body: ReviewDiffBody) {
    const reviewId = randomUUID().slice(0, 8);
    this.sseService.createStream(reviewId);

    // Fire and forget — client reads SSE stream
    this.runDiffReview(reviewId, body).catch(() => {});
    return { reviewId };
  }

  @Post('file')
  async startFileReview(@Body() body: ReviewFileBody) {
    const reviewId = randomUUID().slice(0, 8);
    this.sseService.createStream(reviewId);
    this.runFileReview(reviewId, body).catch(() => {});
    return { reviewId };
  }

  @Post('codebase')
  async startCodebaseReview(@Body() body: ReviewCodebaseBody) {
    const reviewId = randomUUID().slice(0, 8);
    this.sseService.createStream(reviewId);
    this.runCodebaseReview(reviewId, body).catch(() => {});
    return { reviewId };
  }

  @Sse(':reviewId/events')
  streamEvents(@Param('reviewId') reviewId: string): Observable<MessageEvent> {
    const stream = this.sseService.getStream(reviewId);
    if (!stream) {
      throw new NotFoundException(`Review ${reviewId} not found`);
    }
    return stream;
  }

  private async runDiffReview(reviewId: string, body: ReviewDiffBody) {
    try {
      const config = this.configService.getConfig();
      this.emitReviewerProgress(reviewId, config.reviewers.map((r) => r.name));
      const result = await this.reviewService.reviewDiff(
        body.repoPath,
        body.baseBranch ?? 'main',
        body.checks ?? config.review.defaultChecks,
        body.extra,
      );
      this.sseService.emit(reviewId, 'result', result);
    } catch (error) {
      this.sseService.emit(reviewId, 'error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.sseService.complete(reviewId);
    }
  }

  private async runFileReview(reviewId: string, body: ReviewFileBody) {
    try {
      const config = this.configService.getConfig();
      this.emitReviewerProgress(reviewId, config.reviewers.map((r) => r.name));
      const result = await this.reviewService.reviewFiles(
        body.filePaths,
        body.checks ?? config.review.defaultChecks,
        body.extra,
      );
      this.sseService.emit(reviewId, 'result', result);
    } catch (error) {
      this.sseService.emit(reviewId, 'error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.sseService.complete(reviewId);
    }
  }

  private async runCodebaseReview(reviewId: string, body: ReviewCodebaseBody) {
    try {
      const config = this.configService.getConfig();
      this.emitReviewerProgress(reviewId, config.reviewers.map((r) => r.name));
      const result = await this.reviewService.reviewCodebase(
        body.directory,
        {
          extensions: body.extensions?.map((e) => (e.startsWith('.') ? e : `.${e}`)),
          batchSize: body.batchSize,
        },
        body.checks ?? config.review.defaultChecks,
        body.extra,
      );
      this.sseService.emit(reviewId, 'result', result);
    } catch (error) {
      this.sseService.emit(reviewId, 'error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.sseService.complete(reviewId);
    }
  }

  private emitReviewerProgress(reviewId: string, reviewerNames: string[]) {
    for (const name of reviewerNames) {
      this.sseService.emit(reviewId, 'progress', {
        reviewer: name,
        status: 'sending',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
```

**Step 6: Create `apps/api/src/review/review-api.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller.js';
import { ReviewSseService } from './review-sse.service.js';
import { ReviewModule } from '../../../../src/review/review.module.js';

@Module({
  imports: [ReviewModule],
  controllers: [ReviewController],
  providers: [ReviewSseService],
})
export class ReviewApiModule {}
```

**Step 7: Create `apps/api/src/config/config.controller.ts`**

```typescript
import { Controller, Get, Post, Body } from '@nestjs/common';
import { ConfigService } from '../../../../src/config/config.service.js';

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getConfig() {
    return this.configService.getConfig();
  }

  @Post('validate')
  async validateConfig(@Body() body: Record<string, unknown>) {
    try {
      // Create a temporary config service to validate
      const tempService = new ConfigService(
        { setContext: () => {}, log: () => {}, warn: () => {} } as any,
      );
      // Attempt to parse and validate the config
      await tempService.loadConfig();
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid config',
      };
    }
  }
}
```

**Step 8: Create `apps/api/src/config/config-api.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller.js';
import { ConfigModule } from '../../../../src/config/config.module.js';

@Module({
  imports: [ConfigModule],
  controllers: [ConfigController],
})
export class ConfigApiModule {}
```

**Step 9: Create `apps/api/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ReviewApiModule } from './review/review-api.module.js';
import { ConfigApiModule } from './config/config-api.module.js';

@Module({
  imports: [ReviewApiModule, ConfigApiModule],
})
export class AppModule {}
```

**Step 10: Create tsconfig and project.json**

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/apps/api",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true
  },
  "include": ["src/**/*"]
}
```

`apps/api/project.json`:

```json
{
  "name": "api",
  "sourceRoot": "apps/api/src",
  "projectType": "application",
  "tags": ["scope:api"],
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "options": {
        "outputPath": "dist/apps/api",
        "main": "apps/api/src/main.ts",
        "tsConfig": "apps/api/tsconfig.json"
      }
    },
    "serve": {
      "executor": "@nx/js:node",
      "options": {
        "buildTarget": "api:build"
      }
    }
  }
}
```

**Step 11: Verify API builds**

Run: `npx nx build api`
Expected: Build success

**Step 12: Commit**

```bash
git add apps/api/
git commit -m "feat: create NestJS API app with review and config controllers"
```

---

## Task 4: Create API Reference File

Define all API endpoints in `api-reference.json`.

**Files:**
- Create: `api-reference.json`

**Step 1: Create `api-reference.json`**

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "Code Review Council API",
    "version": "0.1.0",
    "description": "Web API for multi-model AI code review"
  },
  "servers": [
    { "url": "http://localhost:3100", "description": "Local dev" }
  ],
  "paths": {
    "/api/reviews/diff": {
      "post": {
        "summary": "Start a diff review",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/ReviewDiffRequest" }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Review started",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ReviewStartedResponse" }
              }
            }
          }
        }
      }
    },
    "/api/reviews/file": {
      "post": {
        "summary": "Start a file review",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/ReviewFileRequest" }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Review started",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ReviewStartedResponse" }
              }
            }
          }
        }
      }
    },
    "/api/reviews/codebase": {
      "post": {
        "summary": "Start a codebase review",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/ReviewCodebaseRequest" }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Review started",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ReviewStartedResponse" }
              }
            }
          }
        }
      }
    },
    "/api/reviews/{reviewId}/events": {
      "get": {
        "summary": "SSE stream for review progress and result",
        "parameters": [
          {
            "name": "reviewId",
            "in": "path",
            "required": true,
            "schema": { "type": "string" }
          }
        ],
        "responses": {
          "200": {
            "description": "SSE event stream",
            "content": {
              "text/event-stream": {
                "schema": {
                  "type": "string",
                  "description": "Events: progress, dm-progress, result, error"
                }
              }
            }
          }
        }
      }
    },
    "/api/config": {
      "get": {
        "summary": "Get current effective config",
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/CouncilConfig" }
              }
            }
          }
        }
      }
    },
    "/api/config/validate": {
      "post": {
        "summary": "Validate a config JSON",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/CouncilConfig" }
            }
          }
        },
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ValidationResult" }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "ReviewDiffRequest": {
        "type": "object",
        "required": ["repoPath"],
        "properties": {
          "repoPath": { "type": "string" },
          "baseBranch": { "type": "string", "default": "main" },
          "checks": { "type": "array", "items": { "type": "string" } },
          "extra": { "type": "string" },
          "config": { "$ref": "#/components/schemas/CouncilConfig" }
        }
      },
      "ReviewFileRequest": {
        "type": "object",
        "required": ["filePaths"],
        "properties": {
          "filePaths": { "type": "array", "items": { "type": "string" } },
          "checks": { "type": "array", "items": { "type": "string" } },
          "extra": { "type": "string" },
          "config": { "$ref": "#/components/schemas/CouncilConfig" }
        }
      },
      "ReviewCodebaseRequest": {
        "type": "object",
        "required": ["directory"],
        "properties": {
          "directory": { "type": "string" },
          "extensions": { "type": "array", "items": { "type": "string" } },
          "batchSize": { "type": "integer", "default": 100000 },
          "checks": { "type": "array", "items": { "type": "string" } },
          "extra": { "type": "string" },
          "config": { "$ref": "#/components/schemas/CouncilConfig" }
        }
      },
      "ReviewStartedResponse": {
        "type": "object",
        "properties": {
          "reviewId": { "type": "string" }
        }
      },
      "CouncilConfig": {
        "type": "object",
        "properties": {
          "reviewers": {
            "type": "array",
            "items": { "$ref": "#/components/schemas/ReviewerConfig" }
          },
          "decisionMaker": { "$ref": "#/components/schemas/ReviewerConfig" },
          "review": { "$ref": "#/components/schemas/ReviewConfig" }
        }
      },
      "ReviewerConfig": {
        "type": "object",
        "required": ["name", "cliPath", "cliArgs"],
        "properties": {
          "name": { "type": "string" },
          "cliPath": { "type": "string" },
          "cliArgs": { "type": "array", "items": { "type": "string" } },
          "protocol": { "type": "string", "enum": ["acp", "copilot"] },
          "model": { "type": "string" },
          "timeoutMs": { "type": "integer" },
          "maxRetries": { "type": "integer" }
        }
      },
      "ReviewConfig": {
        "type": "object",
        "properties": {
          "defaultChecks": { "type": "array", "items": { "type": "string" } },
          "language": { "type": "string" },
          "mode": { "type": "string", "enum": ["inline", "explore"] },
          "extensions": { "type": "array", "items": { "type": "string" } },
          "sensitivePatterns": { "type": "array", "items": { "type": "string" } }
        }
      },
      "ValidationResult": {
        "type": "object",
        "properties": {
          "valid": { "type": "boolean" },
          "error": { "type": "string" }
        }
      }
    }
  }
}
```

**Step 2: Commit**

```bash
git add api-reference.json
git commit -m "docs: create API reference (OpenAPI 3.0)"
```

---

## Task 5: Create Angular App with PrimeNG + Tailwind

Scaffold the Angular 21 frontend app in the Nx workspace.

**Files:**
- Create: `apps/web/` (Angular app scaffold)
- Create: `apps/web/src/styles.css` (Tailwind + PrimeNG)
- Modify: `apps/web/src/app/app.config.ts` (PrimeNG provider)

**Step 1: Install Angular and Nx Angular plugin**

```bash
npm install -D @nx/angular @angular/cli
```

**Step 2: Generate Angular app**

```bash
npx nx generate @nx/angular:application web --directory=apps/web --style=css --routing=false --e2eTestRunner=none --bundler=esbuild --ssr=false
```

**Step 3: Install PrimeNG**

```bash
npm install primeng @primeuix/themes primeicons
```

**Step 4: Install Tailwind CSS v4**

```bash
npm install tailwindcss @tailwindcss/postcss
```

Create `apps/web/.postcssrc.json`:

```json
{
  "plugins": {
    "@tailwindcss/postcss": {}
  }
}
```

**Step 5: Configure styles**

`apps/web/src/styles.css`:

```css
@import 'tailwindcss';
@import 'primeicons/primeicons.css';
```

**Step 6: Configure PrimeNG in app.config.ts**

`apps/web/src/app/app.config.ts`:

```typescript
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Aura,
      },
    }),
  ],
};
```

**Step 7: Verify Angular app serves**

Run: `npx nx serve web`
Expected: Angular dev server on http://localhost:4200

**Step 8: Commit**

```bash
git add apps/web/ package.json package-lock.json
git commit -m "feat: scaffold Angular 21 app with PrimeNG and Tailwind"
```

---

## Task 6: Implement Signal-Based State Store and API Service

Core services for managing application state and HTTP+SSE communication.

**Files:**
- Create: `apps/web/src/app/core/services/review-store.service.ts`
- Create: `apps/web/src/app/core/services/api.service.ts`

**Step 1: Create review store**

`apps/web/src/app/core/services/review-store.service.ts`:

```typescript
import { Injectable, signal, computed } from '@angular/core';
import type {
  CouncilConfig,
  ReviewResult,
  ReviewProgressEvent,
} from '@code-review-council/shared';

export type ReviewMode = 'diff' | 'file' | 'codebase';

@Injectable({ providedIn: 'root' })
export class ReviewStore {
  readonly config = signal<CouncilConfig | null>(null);
  readonly reviewMode = signal<ReviewMode>('codebase');
  readonly isReviewing = signal(false);
  readonly progress = signal<Map<string, ReviewProgressEvent>>(new Map());
  readonly result = signal<ReviewResult | null>(null);
  readonly error = signal<string | null>(null);

  readonly activeReviewers = computed(() => {
    const cfg = this.config();
    return cfg?.reviewers ?? [];
  });

  readonly allReviewersDone = computed(() => {
    const p = this.progress();
    if (p.size === 0) return false;
    return [...p.values()].every((e) => e.status !== 'sending');
  });

  updateProgress(event: ReviewProgressEvent): void {
    this.progress.update((map) => {
      const next = new Map(map);
      next.set(event.reviewer, event);
      return next;
    });
  }

  reset(): void {
    this.isReviewing.set(false);
    this.progress.set(new Map());
    this.result.set(null);
    this.error.set(null);
  }
}
```

**Step 2: Create API service**

`apps/web/src/app/core/services/api.service.ts`:

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  CouncilConfig,
  ReviewResult,
  ReviewProgressEvent,
} from '@code-review-council/shared';
import { ReviewStore } from './review-store.service';

const API_BASE = '/api';

interface ReviewStartedResponse {
  reviewId: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(ReviewStore);

  async getConfig(): Promise<CouncilConfig> {
    const config = await firstValueFrom(
      this.http.get<CouncilConfig>(`${API_BASE}/config`),
    );
    this.store.config.set(config);
    return config;
  }

  async validateConfig(
    config: unknown,
  ): Promise<{ valid: boolean; error?: string }> {
    return firstValueFrom(
      this.http.post<{ valid: boolean; error?: string }>(
        `${API_BASE}/config/validate`,
        config,
      ),
    );
  }

  async startCodebaseReview(params: {
    directory: string;
    extensions?: string[];
    batchSize?: number;
    checks?: string[];
    extra?: string;
    config?: CouncilConfig;
  }): Promise<void> {
    this.store.reset();
    this.store.isReviewing.set(true);

    const { reviewId } = await firstValueFrom(
      this.http.post<ReviewStartedResponse>(
        `${API_BASE}/reviews/codebase`,
        params,
      ),
    );

    this.connectSse(reviewId);
  }

  async startDiffReview(params: {
    repoPath: string;
    baseBranch?: string;
    checks?: string[];
    extra?: string;
    config?: CouncilConfig;
  }): Promise<void> {
    this.store.reset();
    this.store.isReviewing.set(true);

    const { reviewId } = await firstValueFrom(
      this.http.post<ReviewStartedResponse>(
        `${API_BASE}/reviews/diff`,
        params,
      ),
    );

    this.connectSse(reviewId);
  }

  async startFileReview(params: {
    filePaths: string[];
    checks?: string[];
    extra?: string;
    config?: CouncilConfig;
  }): Promise<void> {
    this.store.reset();
    this.store.isReviewing.set(true);

    const { reviewId } = await firstValueFrom(
      this.http.post<ReviewStartedResponse>(
        `${API_BASE}/reviews/file`,
        params,
      ),
    );

    this.connectSse(reviewId);
  }

  private connectSse(reviewId: string): void {
    const eventSource = new EventSource(
      `${API_BASE}/reviews/${reviewId}/events`,
    );

    eventSource.addEventListener('progress', (event: MessageEvent) => {
      const data: ReviewProgressEvent = JSON.parse(event.data);
      this.store.updateProgress(data);
    });

    eventSource.addEventListener('result', (event: MessageEvent) => {
      const result: ReviewResult = JSON.parse(event.data);
      this.store.result.set(result);
      this.store.isReviewing.set(false);
      eventSource.close();
    });

    eventSource.addEventListener('error', (event: MessageEvent) => {
      if (event.data) {
        const data = JSON.parse(event.data);
        this.store.error.set(data.message);
      }
      this.store.isReviewing.set(false);
      eventSource.close();
    });

    eventSource.onerror = () => {
      this.store.error.set('SSE connection lost');
      this.store.isReviewing.set(false);
      eventSource.close();
    };
  }
}
```

**Step 3: Commit**

```bash
git add apps/web/src/app/core/
git commit -m "feat: implement Signal-based review store and API service"
```

---

## Task 7: Implement Review Form Component

Left-panel form with mode selector, path inputs, and reviewer model selection.

**Files:**
- Create: `apps/web/src/app/features/review/review-form.component.ts`
- Create: `apps/web/src/app/features/review/reviewer-selector.component.ts`

**Step 1: Create reviewer selector component**

`apps/web/src/app/features/review/reviewer-selector.component.ts`:

```typescript
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CheckboxModule } from 'primeng/checkbox';
import { DropdownModule } from 'primeng/dropdown';
import { ReviewStore } from '../../core/services/review-store.service';

@Component({
  selector: 'app-reviewer-selector',
  standalone: true,
  imports: [FormsModule, CheckboxModule, DropdownModule],
  template: `
    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-gray-600 uppercase">Reviewers</h3>
      @for (reviewer of store.activeReviewers(); track reviewer.name) {
        <div class="flex items-center gap-2">
          <p-checkbox
            [binary]="true"
            [(ngModel)]="reviewer._enabled"
            [label]="reviewer.name"
          />
          @if (reviewer.protocol === 'copilot') {
            <p-dropdown
              [options]="modelOptions"
              [(ngModel)]="reviewer.model"
              placeholder="Model"
              class="ml-auto w-48"
              size="small"
            />
          }
        </div>
      }

      <h3 class="text-sm font-semibold text-gray-600 uppercase mt-4">
        Decision Maker
      </h3>
      <div class="flex items-center gap-2">
        <span>{{ dmName() }}</span>
        @if (dmProtocol() === 'copilot') {
          <p-dropdown
            [options]="modelOptions"
            [(ngModel)]="dmModel"
            placeholder="Model"
            class="ml-auto w-48"
            size="small"
          />
        }
      </div>
    </div>
  `,
})
export class ReviewerSelectorComponent {
  readonly store = inject(ReviewStore);
  dmModel = '';

  readonly modelOptions = [
    { label: 'claude-sonnet-4.5', value: 'claude-sonnet-4.5' },
    { label: 'claude-sonnet-4.6', value: 'claude-sonnet-4.6' },
    { label: 'gpt-5-mini', value: 'gpt-5-mini' },
    { label: 'gpt-5.3-codex', value: 'gpt-5.3-codex' },
  ];

  dmName = () => this.store.config()?.decisionMaker?.name ?? 'N/A';
  dmProtocol = () => this.store.config()?.decisionMaker?.protocol;
}
```

**Step 2: Create review form component**

`apps/web/src/app/features/review/review-form.component.ts`:

```typescript
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { ReviewStore, ReviewMode } from '../../core/services/review-store.service';
import { ApiService } from '../../core/services/api.service';
import { ReviewerSelectorComponent } from './reviewer-selector.component';

@Component({
  selector: 'app-review-form',
  standalone: true,
  imports: [
    FormsModule,
    SelectButtonModule,
    InputTextModule,
    ButtonModule,
    TextareaModule,
    ReviewerSelectorComponent,
  ],
  template: `
    <div class="space-y-4 p-4">
      <h2 class="text-lg font-bold">Review Mode</h2>
      <p-selectButton
        [options]="modeOptions"
        [(ngModel)]="mode"
        optionLabel="label"
        optionValue="value"
      />

      @switch (mode()) {
        @case ('codebase') {
          <label class="block text-sm font-medium">Directory</label>
          <input pInputText [(ngModel)]="directory" class="w-full" />
          <label class="block text-sm font-medium">Extensions</label>
          <input
            pInputText
            [(ngModel)]="extensions"
            placeholder="ts,js"
            class="w-full"
          />
        }
        @case ('diff') {
          <label class="block text-sm font-medium">Repo Path</label>
          <input pInputText [(ngModel)]="repoPath" class="w-full" />
          <label class="block text-sm font-medium">Base Branch</label>
          <input pInputText [(ngModel)]="baseBranch" class="w-full" />
        }
        @case ('file') {
          <label class="block text-sm font-medium">File Paths (one per line)</label>
          <textarea
            pTextarea
            [(ngModel)]="filePaths"
            rows="4"
            class="w-full"
          ></textarea>
        }
      }

      <label class="block text-sm font-medium">Extra Instructions</label>
      <textarea
        pTextarea
        [(ngModel)]="extra"
        rows="2"
        class="w-full"
        placeholder="Optional: focus on specific areas..."
      ></textarea>

      <app-reviewer-selector />

      <p-button
        label="Start Review"
        icon="pi pi-play"
        (onClick)="startReview()"
        [loading]="store.isReviewing()"
        [disabled]="store.isReviewing()"
        class="w-full"
      />
    </div>
  `,
})
export class ReviewFormComponent {
  readonly store = inject(ReviewStore);
  private readonly api = inject(ApiService);

  mode = this.store.reviewMode;
  directory = signal('');
  extensions = signal('ts');
  repoPath = signal('.');
  baseBranch = signal('main');
  filePaths = signal('');
  extra = signal('');

  modeOptions = [
    { label: 'Codebase', value: 'codebase' },
    { label: 'Diff', value: 'diff' },
    { label: 'File', value: 'file' },
  ];

  async startReview(): Promise<void> {
    const mode = this.mode();
    switch (mode) {
      case 'codebase':
        await this.api.startCodebaseReview({
          directory: this.directory(),
          extensions: this.extensions()
            .split(',')
            .map((e) => e.trim())
            .filter(Boolean),
          extra: this.extra() || undefined,
        });
        break;
      case 'diff':
        await this.api.startDiffReview({
          repoPath: this.repoPath(),
          baseBranch: this.baseBranch(),
          extra: this.extra() || undefined,
        });
        break;
      case 'file':
        await this.api.startFileReview({
          filePaths: this.filePaths()
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean),
          extra: this.extra() || undefined,
        });
        break;
    }
  }
}
```

**Step 3: Commit**

```bash
git add apps/web/src/app/features/review/
git commit -m "feat: implement review form and reviewer selector components"
```

---

## Task 8: Implement Progress Tracker and Result Viewer

Right-panel components for real-time progress and result display.

**Files:**
- Create: `apps/web/src/app/features/review/progress-tracker.component.ts`
- Create: `apps/web/src/app/features/review/decision-table.component.ts`
- Create: `apps/web/src/app/features/review/result-viewer.component.ts`

**Step 1: Create progress tracker**

`apps/web/src/app/features/review/progress-tracker.component.ts`:

```typescript
import { Component, inject, computed } from '@angular/core';
import { CardModule } from 'primeng/card';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { ReviewStore } from '../../core/services/review-store.service';

@Component({
  selector: 'app-progress-tracker',
  standalone: true,
  imports: [CardModule, ProgressSpinnerModule, TagModule],
  template: `
    @if (entries().length > 0) {
      <div class="flex flex-wrap gap-3 mb-4">
        @for (entry of entries(); track entry.reviewer) {
          <p-card class="w-40">
            <div class="text-center">
              <div class="font-semibold mb-2">{{ entry.reviewer }}</div>
              @switch (entry.status) {
                @case ('sending') {
                  <p-progressSpinner
                    strokeWidth="4"
                    [style]="{ width: '2rem', height: '2rem' }"
                  />
                }
                @case ('done') {
                  <p-tag severity="success" value="Done" />
                  @if (entry.durationMs) {
                    <div class="text-xs text-gray-500 mt-1">
                      {{ (entry.durationMs / 1000).toFixed(1) }}s
                    </div>
                  }
                }
                @case ('error') {
                  <p-tag severity="danger" value="Error" />
                  @if (entry.error) {
                    <div class="text-xs text-red-500 mt-1">{{ entry.error }}</div>
                  }
                }
              }
            </div>
          </p-card>
        }
      </div>
    }
  `,
})
export class ProgressTrackerComponent {
  private readonly store = inject(ReviewStore);

  entries = computed(() => [...this.store.progress().values()]);
}
```

**Step 2: Create decision table**

`apps/web/src/app/features/review/decision-table.component.ts`:

```typescript
import { Component, input } from '@angular/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import type { ReviewDecisionItem } from '@code-review-council/shared';

@Component({
  selector: 'app-decision-table',
  standalone: true,
  imports: [TableModule, TagModule],
  template: `
    <p-table [value]="decisions()" [scrollable]="true" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th style="width: 3rem"></th>
          <th>Severity</th>
          <th>Category</th>
          <th>Description</th>
          <th>File</th>
          <th>Reasoning</th>
          <th>Action</th>
          <th>Raised by</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-d>
        <tr>
          <td>{{ verdictIcon(d.verdict) }}</td>
          <td>
            <p-tag
              [severity]="severityColor(d.severity)"
              [value]="d.severity"
            />
          </td>
          <td>{{ d.category }}</td>
          <td>{{ d.description }}</td>
          <td>
            @if (d.file) {
              <code>{{ d.file }}{{ d.line ? ':' + d.line : '' }}</code>
            }
          </td>
          <td>{{ d.reasoning }}</td>
          <td>{{ d.suggestion }}</td>
          <td>{{ d.raisedBy?.join(', ') }}</td>
        </tr>
      </ng-template>
    </p-table>
  `,
})
export class DecisionTableComponent {
  decisions = input.required<ReviewDecisionItem[]>();

  verdictIcon(verdict: string): string {
    if (verdict === 'accepted') return '\u2705';
    if (verdict === 'rejected') return '\u274C';
    return '\u270F\uFE0F';
  }

  severityColor(severity: string): 'danger' | 'warn' | 'info' {
    if (severity === 'high') return 'danger';
    if (severity === 'medium') return 'warn';
    return 'info';
  }
}
```

**Step 3: Create result viewer**

`apps/web/src/app/features/review/result-viewer.component.ts`:

```typescript
import { Component, inject, computed } from '@angular/core';
import { AccordionModule } from 'primeng/accordion';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ReviewStore } from '../../core/services/review-store.service';
import { DecisionTableComponent } from './decision-table.component';
import { ProgressTrackerComponent } from './progress-tracker.component';
import type { ReviewResult } from '@code-review-council/shared';

@Component({
  selector: 'app-result-viewer',
  standalone: true,
  imports: [
    AccordionModule,
    ButtonModule,
    TagModule,
    DecisionTableComponent,
    ProgressTrackerComponent,
  ],
  template: `
    <div class="p-4 space-y-4">
      <app-progress-tracker />

      @if (result(); as r) {
        <div class="flex items-center gap-2 mb-2">
          <h2 class="text-lg font-bold">Individual Reviews</h2>
          <p-tag
            [severity]="r.status === 'completed' ? 'success' : r.status === 'partial' ? 'warn' : 'danger'"
            [value]="r.status"
          />
          @if (r.durationMs) {
            <span class="text-sm text-gray-500">
              {{ (r.durationMs / 1000).toFixed(1) }}s
            </span>
          }
        </div>

        <p-accordion [multiple]="true">
          @for (review of r.individualReviews; track review.reviewer) {
            <p-accordionTab
              [header]="review.reviewer + (review.durationMs ? ' (' + (review.durationMs / 1000).toFixed(1) + 's)' : '')"
            >
              <pre class="whitespace-pre-wrap text-sm">{{ review.review }}</pre>
            </p-accordionTab>
          }
        </p-accordion>

        @if (r.decision) {
          <h2 class="text-lg font-bold mt-4">
            Final Decision (by {{ r.decision.reviewer }})
          </h2>
          <p class="text-sm whitespace-pre-wrap">
            {{ r.decision.overallAssessment }}
          </p>

          @if (r.decision.decisions.length > 0) {
            <h3 class="font-semibold mt-3">Decisions</h3>
            <app-decision-table [decisions]="r.decision.decisions" />
          }

          @if (r.decision.additionalFindings.length > 0) {
            <h3 class="font-semibold mt-3">Additional Findings</h3>
            <app-decision-table [decisions]="toDecisionItems(r.decision.additionalFindings)" />
          }
        }

        <div class="flex gap-2 mt-4">
          <p-button
            label="Download JSON"
            icon="pi pi-download"
            severity="secondary"
            (onClick)="downloadJson(r)"
          />
          <p-button
            label="Download Markdown"
            icon="pi pi-file"
            severity="secondary"
            (onClick)="downloadMarkdown(r)"
          />
        </div>
      }

      @if (store.error(); as err) {
        <div class="p-4 bg-red-50 border border-red-200 rounded text-red-700">
          {{ err }}
        </div>
      }
    </div>
  `,
})
export class ResultViewerComponent {
  readonly store = inject(ReviewStore);
  readonly result = this.store.result;

  toDecisionItems(findings: any[]): any[] {
    return findings.map((f) => ({
      ...f,
      verdict: 'accepted',
      raisedBy: ['Decision Maker'],
      reasoning: '',
    }));
  }

  downloadJson(result: ReviewResult): void {
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: 'application/json',
    });
    this.downloadBlob(blob, `review-${result.id}.json`);
  }

  downloadMarkdown(result: ReviewResult): void {
    const md = this.toMarkdown(result);
    const blob = new Blob([md], { type: 'text/markdown' });
    this.downloadBlob(blob, `review-${result.id}.md`);
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private toMarkdown(result: ReviewResult): string {
    let md = `# Code Review Report\n\n`;
    md += `**Status:** ${result.status}\n`;
    if (result.durationMs)
      md += `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s\n`;
    md += `\n## Individual Reviews\n\n`;
    for (const r of result.individualReviews) {
      md += `### ${r.reviewer}`;
      if (r.durationMs) md += ` (${(r.durationMs / 1000).toFixed(1)}s)`;
      md += `\n\n${r.review}\n\n`;
    }
    if (result.decision) {
      const d = result.decision;
      md += `## Final Decision (by ${d.reviewer})\n\n`;
      md += `${d.overallAssessment}\n\n`;
      if (d.decisions.length > 0) {
        md += `### Decisions\n\n`;
        md += `| | Severity | Category | Description | File | Reasoning | Action | Raised by |\n`;
        md += `|---|---|---|---|---|---|---|---|\n`;
        for (const item of d.decisions) {
          const icon =
            item.verdict === 'accepted'
              ? '\u2705'
              : item.verdict === 'rejected'
                ? '\u274C'
                : '\u270F\uFE0F';
          const file = item.file
            ? `${item.file}${item.line ? ':' + item.line : ''}`
            : '';
          md += `| ${icon} | ${item.severity} | ${item.category} | ${item.description} | ${file} | ${item.reasoning} | ${item.suggestion} | ${item.raisedBy?.join(', ')} |\n`;
        }
        md += `\n`;
      }
    }
    return md;
  }
}
```

**Step 4: Commit**

```bash
git add apps/web/src/app/features/review/
git commit -m "feat: implement progress tracker, decision table, and result viewer"
```

---

## Task 9: Implement Config Editor

JSON editor component for viewing/editing the review config.

**Files:**
- Create: `apps/web/src/app/features/config/config-editor.component.ts`

**Step 1: Create config editor component**

`apps/web/src/app/features/config/config-editor.component.ts`:

```typescript
import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TextareaModule } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ReviewStore } from '../../core/services/review-store.service';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'app-config-editor',
  standalone: true,
  imports: [FormsModule, TextareaModule, ButtonModule, TagModule],
  template: `
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-gray-600 uppercase">Config</h3>
        <p-button
          label="Load Server Config"
          icon="pi pi-cloud-download"
          size="small"
          severity="secondary"
          (onClick)="loadConfig()"
        />
      </div>

      <textarea
        pTextarea
        [(ngModel)]="configJson"
        rows="12"
        class="w-full font-mono text-xs"
        placeholder="Paste or edit JSON config..."
      ></textarea>

      <div class="flex items-center gap-2">
        <p-button
          label="Apply"
          icon="pi pi-check"
          size="small"
          (onClick)="applyConfig()"
        />
        @if (validationStatus() === 'valid') {
          <p-tag severity="success" value="Valid" />
        }
        @if (validationStatus() === 'invalid') {
          <p-tag severity="danger" [value]="validationError()" />
        }
      </div>
    </div>
  `,
})
export class ConfigEditorComponent implements OnInit {
  private readonly store = inject(ReviewStore);
  private readonly api = inject(ApiService);

  configJson = signal('');
  validationStatus = signal<'none' | 'valid' | 'invalid'>('none');
  validationError = signal('');

  async ngOnInit(): Promise<void> {
    await this.loadConfig();
  }

  async loadConfig(): Promise<void> {
    try {
      const config = await this.api.getConfig();
      this.configJson.set(JSON.stringify(config, null, 2));
      this.validationStatus.set('valid');
    } catch {
      this.validationStatus.set('invalid');
      this.validationError.set('Failed to load server config');
    }
  }

  async applyConfig(): Promise<void> {
    try {
      const parsed = JSON.parse(this.configJson());
      const result = await this.api.validateConfig(parsed);
      if (result.valid) {
        this.store.config.set(parsed);
        this.validationStatus.set('valid');
      } else {
        this.validationStatus.set('invalid');
        this.validationError.set(result.error ?? 'Invalid config');
      }
    } catch (e) {
      this.validationStatus.set('invalid');
      this.validationError.set(
        e instanceof SyntaxError ? 'Invalid JSON' : 'Validation failed',
      );
    }
  }
}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/features/config/
git commit -m "feat: implement config editor component"
```

---

## Task 10: Wire Up Main Page Layout

Create the two-panel review page and configure routing.

**Files:**
- Create: `apps/web/src/app/features/review/review-page.component.ts`
- Modify: `apps/web/src/app/app.component.ts`
- Modify: `apps/web/src/app/app.routes.ts` (if exists)

**Step 1: Create review page layout**

`apps/web/src/app/features/review/review-page.component.ts`:

```typescript
import { Component } from '@angular/core';
import { ReviewFormComponent } from './review-form.component';
import { ResultViewerComponent } from './result-viewer.component';
import { ConfigEditorComponent } from '../config/config-editor.component';

@Component({
  selector: 'app-review-page',
  standalone: true,
  imports: [ReviewFormComponent, ResultViewerComponent, ConfigEditorComponent],
  template: `
    <div class="h-screen flex flex-col">
      <header class="bg-gray-900 text-white px-6 py-3 flex items-center gap-3">
        <h1 class="text-xl font-bold">Code Review Council</h1>
      </header>

      <div class="flex flex-1 overflow-hidden">
        <!-- Left Panel -->
        <aside class="w-96 border-r overflow-y-auto bg-gray-50">
          <app-review-form />
          <div class="border-t p-4">
            <app-config-editor />
          </div>
        </aside>

        <!-- Right Panel -->
        <main class="flex-1 overflow-y-auto">
          <app-result-viewer />
        </main>
      </div>
    </div>
  `,
})
export class ReviewPageComponent {}
```

**Step 2: Update app.component.ts**

`apps/web/src/app/app.component.ts`:

```typescript
import { Component } from '@angular/core';
import { ReviewPageComponent } from './features/review/review-page.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ReviewPageComponent],
  template: `<app-review-page />`,
})
export class AppComponent {}
```

**Step 3: Configure API proxy for development**

Create `apps/web/proxy.conf.json`:

```json
{
  "/api": {
    "target": "http://localhost:3100",
    "secure": false
  }
}
```

Add to `apps/web/project.json` serve target:

```json
"options": {
  "proxyConfig": "apps/web/proxy.conf.json"
}
```

**Step 4: Verify both apps serve**

Terminal 1: `npx nx serve api`
Terminal 2: `npx nx serve web`
Expected: API on port 3100, Angular on port 4200 with proxy to API

**Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat: wire up main review page layout with API proxy"
```

---

## Task 11: Integration Smoke Test

Verify the full flow end-to-end.

**Step 1: Start both servers**

```bash
npx nx serve api &
npx nx serve web
```

**Step 2: Manual verification checklist**

- [ ] Open http://localhost:4200
- [ ] Config editor loads server config
- [ ] Select "codebase" mode, enter a directory path
- [ ] Click "Start Review"
- [ ] Progress cards appear for each reviewer
- [ ] Individual reviews display in accordion
- [ ] Decision table renders correctly
- [ ] Download JSON works
- [ ] Download Markdown works

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: integration smoke test complete"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Initialize Nx monorepo | `nx.json`, `package.json` |
| 2 | Create shared types lib | `libs/shared/` |
| 3 | Create NestJS API app | `apps/api/` |
| 4 | Create API reference | `api-reference.json` |
| 5 | Scaffold Angular app | `apps/web/` |
| 6 | State store + API service | `core/services/` |
| 7 | Review form + selectors | `features/review/` |
| 8 | Progress + result viewer | `features/review/` |
| 9 | Config editor | `features/config/` |
| 10 | Main page layout + proxy | `app.component.ts` |
| 11 | Integration smoke test | — |
