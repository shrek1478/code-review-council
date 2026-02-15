import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { ReviewService } from './review.service.js';
import { CodeReaderService } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { DecisionMakerService } from './decision-maker.service.js';
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
      { reviewer: 'Codex', review: 'LGTM' },
    ]),
  };
  const mockDecisionMaker = {
    decide: vi.fn().mockResolvedValue({
      reviewer: 'Claude (Decision Maker)',
      overallAssessment: 'Code is clean.',
      decisions: [],
      additionalFindings: [],
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
      { reviewer: 'Codex', review: 'LGTM' },
    ]);
    mockDecisionMaker.decide.mockResolvedValue({
      reviewer: 'Claude (Decision Maker)',
      overallAssessment: 'Code is clean.',
      decisions: [],
      additionalFindings: [],
    });
    mockAcpService.stopAll.mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: ConsoleLogger, useValue: new ConsoleLogger() },
        { provide: CodeReaderService, useValue: mockCodeReader },
        { provide: CouncilService, useValue: mockCouncil },
        { provide: DecisionMakerService, useValue: mockDecisionMaker },
        { provide: AcpService, useValue: mockAcpService },
      ],
    }).compile();
    service = module.get(ReviewService);
  });

  it('should review git diff end-to-end', async () => {
    const result = await service.reviewDiff('/tmp/repo', 'main');
    expect(result.status).toBe('completed');
    expect(result.individualReviews.length).toBe(2);
    expect(result.decision).toBeDefined();
    expect(mockCodeReader.readGitDiff).toHaveBeenCalledWith('/tmp/repo', 'main');
    // Decision maker receives both code and reviews
    expect(mockDecisionMaker.decide).toHaveBeenCalledWith(
      'diff --git a/test.ts',
      expect.arrayContaining([
        expect.objectContaining({ reviewer: 'Gemini' }),
      ]),
    );
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
      expect(result.decision).toBeDefined();
      expect(mockCodeReader.readCodebase).toHaveBeenCalledWith('/tmp/project', {});
      expect(mockCouncil.dispatchReviews).toHaveBeenCalledTimes(1);
    });

    it('should review multi-batch codebase with file summary for decision maker', async () => {
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
      expect(mockDecisionMaker.decide).toHaveBeenCalledTimes(1);

      // Decision maker receives file summary (not full code) in multi-batch mode
      const decideCalls = mockDecisionMaker.decide.mock.calls[0];
      expect(decideCalls[0]).toContain('batch1.ts');
      expect(decideCalls[0]).toContain('lines');
      expect(decideCalls[2]).toBe(true); // isSummaryMode
    });

    it('should throw when no files found', async () => {
      mockCodeReader.readCodebase.mockRejectedValue(new Error('No files found in codebase'));
      await expect(service.reviewCodebase('/tmp/empty')).rejects.toThrow('No files found in codebase');
    });
  });
});
