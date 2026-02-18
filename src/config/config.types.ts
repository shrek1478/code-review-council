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
  allowLocalExploration?: boolean;
  extensions?: string[];
  sensitivePatterns?: string[];
}

export interface CouncilConfig {
  reviewers: ReviewerConfig[];
  decisionMaker: ReviewerConfig;
  review: ReviewConfig;
}
