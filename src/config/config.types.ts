export interface ReviewerConfig {
  name: string;
  cliPath: string;
  cliArgs: string[];
  model?: string;
}

export interface ReviewConfig {
  defaultChecks: string[];
  language: string;
}

export interface CouncilConfig {
  reviewers: ReviewerConfig[];
  decisionMaker: ReviewerConfig;
  review: ReviewConfig;
}
