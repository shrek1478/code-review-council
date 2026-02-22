export interface ReviewerConfig {
  name: string;
  cliPath: string;
  cliArgs: string[];
  protocol?: 'acp' | 'copilot';
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  streaming?: boolean;
}

export interface ReviewConfig {
  defaultChecks: string[];
  language: string;
  maxReviewsLength?: number;
  maxCodeLength?: number;
  maxSummaryLength?: number;
  mode?: 'inline' | 'batch' | 'explore';
  extensions?: string[];
  sensitivePatterns?: string[];
  /** Glob patterns for files to exclude from codebase/file reviews (e.g. test files). */
  excludePatterns?: string[];
}

export interface CouncilConfig {
  reviewers: ReviewerConfig[];
  decisionMaker: ReviewerConfig;
  review: ReviewConfig;
}
