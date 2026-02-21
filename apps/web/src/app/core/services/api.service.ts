import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  ReviewStore,
  CouncilConfig,
  ReviewResult,
  ReviewProgressEvent,
} from './review-store.service';

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
