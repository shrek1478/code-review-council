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
});
