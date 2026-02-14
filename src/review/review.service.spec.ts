import { Test } from '@nestjs/testing';
import { ReviewService } from './review.service.js';
import { CodeReaderService } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { SummarizerService } from './summarizer.service.js';
import { AcpService } from '../acp/acp.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ReviewService', () => {
  let service: ReviewService;

  const mockCodeReader = {
    readGitDiff: vi.fn().mockResolvedValue('diff --git a/test.ts'),
    readFiles: vi.fn().mockResolvedValue([{ path: 'test.ts', content: 'const x = 1;' }]),
    readCodebase: vi.fn().mockResolvedValue([[
      { path: 'src/app.ts', content: 'const app = 1;' },
      { path: 'src/main.ts', content: 'const main = 2;' },
    ]]),
  };
  const mockCouncil = {
    dispatchReviews: vi.fn().mockResolvedValue([
      { reviewer: 'Gemini', review: 'Looks good' },
      { reviewer: 'Claude', review: 'LGTM' },
    ]),
  };
  const mockSummarizer = {
    summarize: vi.fn().mockResolvedValue({
      reviewer: 'Claude (Summarizer)',
      aggregatedReview: 'Code is clean.',
      issues: [],
    }),
  };
  const mockAcpService = { stopAll: vi.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCodeReader.readGitDiff.mockResolvedValue('diff --git a/test.ts');
    mockCodeReader.readFiles.mockResolvedValue([{ path: 'test.ts', content: 'const x = 1;' }]);
    mockCodeReader.readCodebase.mockResolvedValue([[
      { path: 'src/app.ts', content: 'const app = 1;' },
      { path: 'src/main.ts', content: 'const main = 2;' },
    ]]);
    mockCouncil.dispatchReviews.mockResolvedValue([
      { reviewer: 'Gemini', review: 'Looks good' },
      { reviewer: 'Claude', review: 'LGTM' },
    ]);
    mockSummarizer.summarize.mockResolvedValue({
      reviewer: 'Claude (Summarizer)',
      aggregatedReview: 'Code is clean.',
      issues: [],
    });
    mockAcpService.stopAll.mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: CodeReaderService, useValue: mockCodeReader },
        { provide: CouncilService, useValue: mockCouncil },
        { provide: SummarizerService, useValue: mockSummarizer },
        { provide: AcpService, useValue: mockAcpService },
      ],
    }).compile();
    service = module.get(ReviewService);
  });

  it('should review git diff end-to-end', async () => {
    const result = await service.reviewDiff('/tmp/repo', 'main');
    expect(result.status).toBe('completed');
    expect(result.individualReviews.length).toBe(2);
    expect(result.summary).toBeDefined();
    expect(mockCodeReader.readGitDiff).toHaveBeenCalledWith('/tmp/repo', 'main');
  });

  it('should review files end-to-end', async () => {
    const result = await service.reviewFiles(['test.ts']);
    expect(result.status).toBe('completed');
    expect(result.individualReviews.length).toBe(2);
    expect(mockCodeReader.readFiles).toHaveBeenCalledWith(['test.ts']);
  });

  describe('reviewCodebase', () => {
    it('should review single-batch codebase', async () => {
      const result = await service.reviewCodebase('/tmp/project');
      expect(result.status).toBe('completed');
      expect(result.individualReviews.length).toBe(2);
      expect(result.summary).toBeDefined();
      expect(mockCodeReader.readCodebase).toHaveBeenCalledWith('/tmp/project', {});
      expect(mockCouncil.dispatchReviews).toHaveBeenCalledTimes(1);
    });

    it('should review multi-batch codebase', async () => {
      mockCodeReader.readCodebase.mockResolvedValue([
        [{ path: 'batch1.ts', content: 'a' }],
        [{ path: 'batch2.ts', content: 'b' }],
        [{ path: 'batch3.ts', content: 'c' }],
      ]);
      const result = await service.reviewCodebase('/tmp/project');
      expect(result.status).toBe('completed');
      expect(mockCouncil.dispatchReviews).toHaveBeenCalledTimes(3);
      // 3 batches * 2 reviewers each = 6 individual reviews
      expect(result.individualReviews.length).toBe(6);
      expect(mockSummarizer.summarize).toHaveBeenCalledTimes(1);
    });

    it('should throw when no files found', async () => {
      mockCodeReader.readCodebase.mockRejectedValue(new Error('No files found in codebase'));
      await expect(service.reviewCodebase('/tmp/empty')).rejects.toThrow('No files found in codebase');
    });
  });
});
