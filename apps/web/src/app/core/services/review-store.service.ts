import { Injectable, signal, computed } from '@angular/core';

export type ReviewMode = 'diff' | 'file' | 'codebase';

export interface ReviewProgressEvent {
  reviewer: string;
  status: 'sending' | 'done' | 'error';
  durationMs?: number;
  error?: string;
  timestamp: string;
}

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
  mode?: 'inline' | 'explore';
  extensions?: string[];
}

export interface CouncilConfig {
  reviewers: ReviewerConfig[];
  decisionMaker: ReviewerConfig;
  review: ReviewConfig;
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

export interface IndividualReview {
  reviewer: string;
  review: string;
  status: 'success' | 'error';
  durationMs?: number;
}

export interface ReviewResult {
  id: string;
  status: 'completed' | 'failed' | 'partial';
  individualReviews: IndividualReview[];
  decision?: ReviewDecision;
  durationMs?: number;
}

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
