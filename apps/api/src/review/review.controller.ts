import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Sse,
  NotFoundException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { ReviewService } from '../../../../src/review/review.service.js';
import { ConfigService } from '../../../../src/config/config.service.js';
import { ReviewSseService } from './review-sse.service.js';

interface ReviewDiffBody {
  repoPath: string;
  baseBranch?: string;
  checks?: string[];
  extra?: string;
}

interface ReviewFileBody {
  filePaths: string[];
  checks?: string[];
  extra?: string;
}

interface ReviewCodebaseBody {
  directory: string;
  extensions?: string[];
  batchSize?: number;
  checks?: string[];
  extra?: string;
}

@Controller('reviews')
export class ReviewController {
  constructor(
    private readonly reviewService: ReviewService,
    private readonly configService: ConfigService,
    private readonly sseService: ReviewSseService,
  ) {}

  @Post('diff')
  startDiffReview(@Body() body: ReviewDiffBody) {
    const reviewId = randomUUID().slice(0, 8);
    this.sseService.createStream(reviewId);
    this.runDiffReview(reviewId, body).catch(() => {});
    return { reviewId };
  }

  @Post('file')
  startFileReview(@Body() body: ReviewFileBody) {
    const reviewId = randomUUID().slice(0, 8);
    this.sseService.createStream(reviewId);
    this.runFileReview(reviewId, body).catch(() => {});
    return { reviewId };
  }

  @Post('codebase')
  startCodebaseReview(@Body() body: ReviewCodebaseBody) {
    const reviewId = randomUUID().slice(0, 8);
    this.sseService.createStream(reviewId);
    this.runCodebaseReview(reviewId, body).catch(() => {});
    return { reviewId };
  }

  @Sse(':reviewId/events')
  streamEvents(@Param('reviewId') reviewId: string): Observable<any> {
    const stream = this.sseService.getStream(reviewId);
    if (!stream) {
      throw new NotFoundException(`Review ${reviewId} not found`);
    }
    return stream;
  }

  private async runDiffReview(reviewId: string, body: ReviewDiffBody) {
    try {
      const config = this.configService.getConfig();
      for (const r of config.reviewers) {
        this.sseService.emit(reviewId, 'progress', {
          reviewer: r.name,
          status: 'sending',
          timestamp: new Date().toISOString(),
        });
      }
      const result = await this.reviewService.reviewDiff(
        body.repoPath,
        body.baseBranch ?? 'main',
        body.checks ?? config.review.defaultChecks,
        body.extra,
      );
      this.sseService.emit(reviewId, 'result', result);
    } catch (error) {
      this.sseService.emit(reviewId, 'error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.sseService.complete(reviewId);
    }
  }

  private async runFileReview(reviewId: string, body: ReviewFileBody) {
    try {
      const config = this.configService.getConfig();
      for (const r of config.reviewers) {
        this.sseService.emit(reviewId, 'progress', {
          reviewer: r.name,
          status: 'sending',
          timestamp: new Date().toISOString(),
        });
      }
      const result = await this.reviewService.reviewFiles(
        body.filePaths,
        body.checks ?? config.review.defaultChecks,
        body.extra,
      );
      this.sseService.emit(reviewId, 'result', result);
    } catch (error) {
      this.sseService.emit(reviewId, 'error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.sseService.complete(reviewId);
    }
  }

  private async runCodebaseReview(reviewId: string, body: ReviewCodebaseBody) {
    try {
      const config = this.configService.getConfig();
      for (const r of config.reviewers) {
        this.sseService.emit(reviewId, 'progress', {
          reviewer: r.name,
          status: 'sending',
          timestamp: new Date().toISOString(),
        });
      }
      const result = await this.reviewService.reviewCodebase(
        body.directory,
        {
          extensions: body.extensions?.map((e) => (e.startsWith('.') ? e : `.${e}`)),
          maxBatchSize: body.batchSize,
        },
        body.checks ?? config.review.defaultChecks,
        body.extra,
      );
      this.sseService.emit(reviewId, 'result', result);
    } catch (error) {
      this.sseService.emit(reviewId, 'error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.sseService.complete(reviewId);
    }
  }
}
