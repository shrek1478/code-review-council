import { Test } from '@nestjs/testing';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ReviewController', () => {
  let controller: ReviewController;
  const mockReviewService = {
    reviewDiff: vi.fn().mockResolvedValue({
      id: 'review-abc',
      status: 'completed',
      individualReviews: [],
      decision: { reviewer: 'Claude (Decision Maker)', overallAssessment: 'OK', decisions: [], additionalFindings: [] },
    }),
    reviewFiles: vi.fn().mockResolvedValue({
      id: 'review-def',
      status: 'completed',
      individualReviews: [],
      decision: { reviewer: 'Claude (Decision Maker)', overallAssessment: 'OK', decisions: [], additionalFindings: [] },
    }),
    reviewCodebase: vi.fn().mockResolvedValue({
      id: 'review-ghi',
      status: 'completed',
      individualReviews: [],
      decision: { reviewer: 'Claude (Decision Maker)', overallAssessment: 'OK', decisions: [], additionalFindings: [] },
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockReviewService.reviewDiff.mockResolvedValue({
      id: 'review-abc', status: 'completed', individualReviews: [],
      decision: { reviewer: 'Claude (Decision Maker)', overallAssessment: 'OK', decisions: [], additionalFindings: [] },
    });
    mockReviewService.reviewFiles.mockResolvedValue({
      id: 'review-def', status: 'completed', individualReviews: [],
      decision: { reviewer: 'Claude (Decision Maker)', overallAssessment: 'OK', decisions: [], additionalFindings: [] },
    });
    mockReviewService.reviewCodebase.mockResolvedValue({
      id: 'review-ghi', status: 'completed', individualReviews: [],
      decision: { reviewer: 'Claude (Decision Maker)', overallAssessment: 'OK', decisions: [], additionalFindings: [] },
    });

    const module = await Test.createTestingModule({
      controllers: [ReviewController],
      providers: [{ provide: ReviewService, useValue: mockReviewService }],
    }).compile();
    controller = module.get(ReviewController);
  });

  it('should handle POST /review/diff', async () => {
    const result = await controller.reviewDiff({
      repoPath: '/tmp/repo',
      baseBranch: 'main',
    });
    expect(result.status).toBe('completed');
    expect(mockReviewService.reviewDiff).toHaveBeenCalledWith('/tmp/repo', 'main', undefined, undefined);
  });

  it('should handle POST /review/file', async () => {
    const result = await controller.reviewFiles({
      files: ['src/app.ts'],
    });
    expect(result.status).toBe('completed');
    expect(mockReviewService.reviewFiles).toHaveBeenCalledWith(['src/app.ts'], undefined, undefined);
  });

  it('should handle POST /review/codebase', async () => {
    const result = await controller.reviewCodebase({
      directory: '/tmp/project',
      extensions: ['.ts', '.js'],
      maxBatchSize: 50000,
    });
    expect(result.status).toBe('completed');
    expect(mockReviewService.reviewCodebase).toHaveBeenCalledWith(
      '/tmp/project',
      { extensions: ['.ts', '.js'], maxBatchSize: 50000 },
      undefined,
      undefined,
    );
  });
});
