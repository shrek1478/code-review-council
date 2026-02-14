export interface ReviewerConfig {
  name: string;
  cliPath: string;
  cliArgs: string[];
}

export interface ReviewConfig {
  defaultChecks: string[];
  language: string;
}

export interface CouncilConfig {
  reviewers: ReviewerConfig[];
  summarizer: ReviewerConfig;
  review: ReviewConfig;
}
