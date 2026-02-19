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
}

export interface ReviewResult {
  id: string;
  status: 'completed' | 'failed' | 'partial';
  individualReviews: IndividualReview[];
  decision?: ReviewDecision;
  durationMs?: number;
}

export interface ReviewRequest {
  code?: string;
  checks: string[];
  extraInstructions?: string;
  language?: string;
  repoPath?: string;
  filePaths?: string[];
}
