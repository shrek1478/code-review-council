export interface IndividualReview {
  reviewer: string;
  review: string;
}

export interface ReviewIssue {
  severity: 'high' | 'medium' | 'low';
  category: string;
  description: string;
  file?: string;
  line?: number;
  agreedBy: string[];
  suggestion: string;
}

export interface ReviewSummary {
  reviewer: string;
  aggregatedReview: string;
  issues: ReviewIssue[];
}

export interface ReviewResult {
  id: string;
  status: 'pending' | 'reviewing' | 'completed' | 'failed';
  individualReviews: IndividualReview[];
  summary?: ReviewSummary;
}

export interface ReviewRequest {
  code: string;
  checks: string[];
  extraInstructions?: string;
  language?: string;
}
