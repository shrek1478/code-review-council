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
