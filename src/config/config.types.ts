export interface ReviewerConfig {
  name: string;
  cliPath: string;
  cliArgs: string[];
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
}

export interface CouncilConfig {
  reviewers: ReviewerConfig[];
  decisionMaker: ReviewerConfig;
  review: ReviewConfig;
}
