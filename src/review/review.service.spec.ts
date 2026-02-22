import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { ReviewService } from './review.service.js';
import { CodeReaderService } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { DecisionMakerService } from './decision-maker.service.js';
import { ConfigService } from '../config/config.service.js';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ReviewService', () => {
  let service: ReviewService;

  const mockCodeReader = {
    readGitDiff: vi.fn().mockResolvedValue('diff --git a/test.ts'),
    readFiles: vi
      .fn()
      .mockResolvedValue([{ path: 'test.ts', content: 'const x = 1;' }]),
    readCodebase: vi.fn().mockResolvedValue([
      [
        { path: 'src/app.ts', content: 'const app = 1;' },
        { path: 'src/main.ts', content: 'const main = 2;' },
      ],
    ]),
    createBatches: vi.fn((items: any[]) => [items]),
    listCodebaseFiles: vi.fn().mockResolvedValue(['src/app.ts', 'src/main.ts']),
    isSensitiveFile: vi.fn().mockReturnValue(false),
  };
  const mockCouncil = {
    dispatchReviews: vi.fn().mockResolvedValue([
      { reviewer: 'Gemini', review: 'Looks good', status: 'success' },
      { reviewer: 'Codex', review: 'LGTM', status: 'success' },
    ]),
    synthesizeReview: vi.fn().mockImplementation(
      (reviewerConfig: any, batchReviews: any[]) =>
        Promise.resolve({
          reviewer: reviewerConfig.name,
          review: batchReviews.map((r: any) => r.review).join('\n'),
          status: 'success' as const,
          durationMs: 0,
        }),
    ),
  };
  const mockDecisionMaker = {
    decide: vi.fn().mockResolvedValue({
      reviewer: 'Claude (Decision Maker)',
      overallAssessment: 'Code is clean.',
      decisions: [],
      additionalFindings: [],
    }),
  };
  const mockConfigService = {
    getConfig: vi.fn().mockReturnValue({
      reviewers: [
        { name: 'Gemini', cliPath: 'gemini', cliArgs: [] },
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ],
      review: { mode: 'batch' },
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCodeReader.readGitDiff.mockResolvedValue('diff --git a/test.ts');
    mockCodeReader.readFiles.mockResolvedValue([
      { path: 'test.ts', content: 'const x = 1;' },
    ]);
    mockCodeReader.readCodebase.mockResolvedValue([
      [
        { path: 'src/app.ts', content: 'const app = 1;' },
        { path: 'src/main.ts', content: 'const main = 2;' },
      ],
    ]);
    mockCodeReader.createBatches.mockImplementation((items: any[]) => [items]);
    mockCodeReader.listCodebaseFiles.mockResolvedValue([
      'src/app.ts',
      'src/main.ts',
    ]);
    mockCouncil.dispatchReviews.mockResolvedValue([
      { reviewer: 'Gemini', review: 'Looks good', status: 'success' },
      { reviewer: 'Codex', review: 'LGTM', status: 'success' },
    ]);
    mockCouncil.synthesizeReview.mockImplementation(
      (reviewerConfig: any, batchReviews: any[]) =>
        Promise.resolve({
          reviewer: reviewerConfig.name,
          review: batchReviews.map((r: any) => r.review).join('\n'),
          status: 'success' as const,
          durationMs: 0,
        }),
    );
    mockDecisionMaker.decide.mockResolvedValue({
      reviewer: 'Claude (Decision Maker)',
      overallAssessment: 'Code is clean.',
      decisions: [],
      additionalFindings: [],
    });
    mockConfigService.getConfig.mockReturnValue({
      reviewers: [
        { name: 'Gemini', cliPath: 'gemini', cliArgs: [] },
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ],
      review: { mode: 'batch' },
    });
    const module = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: ConsoleLogger, useValue: new ConsoleLogger() },
        { provide: CodeReaderService, useValue: mockCodeReader },
        { provide: CouncilService, useValue: mockCouncil },
        { provide: DecisionMakerService, useValue: mockDecisionMaker },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get(ReviewService);
  });

  it('should review git diff end-to-end', async () => {
    const result = await service.reviewDiff('/tmp/repo', 'main');
    expect(result.status).toBe('completed');
    expect(result.individualReviews.length).toBe(2);
    expect(result.decision).toBeDefined();
    expect(mockCodeReader.readGitDiff).toHaveBeenCalledWith(
      '/tmp/repo',
      'main',
    );
    // Decision maker receives both code and reviews
    const decideCalls = mockDecisionMaker.decide.mock.calls[0];
    expect(decideCalls[0]).toBe('diff --git a/test.ts');
    expect(decideCalls[1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ reviewer: 'Gemini' })]),
    );
    expect(decideCalls[2]).toBe('inline');
  });

  it('should review files end-to-end', async () => {
    const result = await service.reviewFiles(['test.ts']);
    expect(result.status).toBe('completed');
    expect(result.individualReviews.length).toBe(2);
    expect(mockCodeReader.readFiles).toHaveBeenCalledWith(['test.ts']);
    expect(mockCodeReader.createBatches).toHaveBeenCalled();
  });

  it('should batch reviewFiles when createBatches returns multiple batches', async () => {
    mockCodeReader.readFiles.mockResolvedValue([
      { path: 'a.ts', content: 'aaa' },
      { path: 'b.ts', content: 'bbb' },
    ]);
    mockCodeReader.createBatches.mockReturnValue([
      [{ path: 'a.ts', content: 'aaa' }],
      [{ path: 'b.ts', content: 'bbb' }],
    ]);
    const result = await service.reviewFiles(['a.ts', 'b.ts']);
    expect(result.status).toBe('completed');
    expect(mockCouncil.dispatchReviews).toHaveBeenCalledTimes(2);
    // After synthesis, one review per reviewer (2 reviewers)
    expect(result.individualReviews.length).toBe(2);
    const batchDecideCalls = mockDecisionMaker.decide.mock.calls[0];
    expect(batchDecideCalls[0]).toContain('a.ts');
    expect(batchDecideCalls[1]).toBeInstanceOf(Array);
    expect(batchDecideCalls[2]).toBe('batch');
  });

  describe('reviewCodebase', () => {
    it('should review single-batch codebase', async () => {
      const result = await service.reviewCodebase('/tmp/project');
      expect(result.status).toBe('completed');
      expect(result.individualReviews.length).toBe(2);
      expect(result.decision).toBeDefined();
      expect(mockCodeReader.readCodebase).toHaveBeenCalledWith(
        '/tmp/project',
        {},
      );
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
      // After synthesis, one review per reviewer (2 reviewers)
      expect(result.individualReviews.length).toBe(2);
      expect(mockDecisionMaker.decide).toHaveBeenCalledTimes(1);

      // Decision maker receives file summary (not full code) in multi-batch mode
      const decideCalls = mockDecisionMaker.decide.mock.calls[0];
      expect(decideCalls[0]).toContain('batch1.ts');
      expect(decideCalls[0]).toContain('lines');
      expect(decideCalls[2]).toBe('batch');
      // Additional args are passed (cwd, configOverride, onDmDelta, onDmStart)
      expect(decideCalls.length).toBeGreaterThanOrEqual(3);
    });

    it('should throw when no files found', async () => {
      mockCodeReader.readCodebase.mockRejectedValue(
        new Error('No files found in codebase'),
      );
      await expect(service.reviewCodebase('/tmp/empty')).rejects.toThrow(
        'No files found in codebase',
      );
    });
  });

  describe('decision maker failure degradation', () => {
    it('should return partial result when decision maker fails for reviewDiff', async () => {
      mockDecisionMaker.decide.mockRejectedValue(new Error('DM timeout'));
      const result = await service.reviewDiff('/tmp/repo', 'main');
      expect(result.status).toBe('partial');
      expect(result.individualReviews.length).toBe(2);
      expect(result.decision).toBeUndefined();
    });

    it('should return partial result when decision maker fails for reviewFiles', async () => {
      mockDecisionMaker.decide.mockRejectedValue(new Error('DM error'));
      const result = await service.reviewFiles(['test.ts']);
      expect(result.status).toBe('partial');
      expect(result.individualReviews.length).toBe(2);
      expect(result.decision).toBeUndefined();
    });

    it('should return partial result when decision maker fails for reviewCodebase', async () => {
      mockDecisionMaker.decide.mockRejectedValue(new Error('DM crash'));
      const result = await service.reviewCodebase('/tmp/project');
      expect(result.status).toBe('partial');
      expect(result.individualReviews.length).toBe(2);
      expect(result.decision).toBeUndefined();
    });

    it('should return partial result for multi-batch when decision maker fails', async () => {
      mockCodeReader.readCodebase.mockResolvedValue([
        [{ path: 'a.ts', content: 'aaa' }],
        [{ path: 'b.ts', content: 'bbb' }],
      ]);
      mockDecisionMaker.decide.mockRejectedValue(new Error('DM error'));
      const result = await service.reviewCodebase('/tmp/project');
      expect(result.status).toBe('partial');
      // After synthesis, one review per reviewer (2 reviewers)
      expect(result.individualReviews.length).toBe(2);
      expect(result.decision).toBeUndefined();
    });
  });

  describe('exploration mode (mode=explore)', () => {
    beforeEach(() => {
      mockConfigService.getConfig.mockReturnValue({
        review: { mode: 'explore' },
      });
    });

    it('reviewDiff should still send diff but include repoPath', async () => {
      const result = await service.reviewDiff('/tmp/repo', 'main');
      expect(result.status).toBe('completed');
      expect(mockCodeReader.readGitDiff).toHaveBeenCalledWith(
        '/tmp/repo',
        'main',
      );

      // Should pass repoPath to council
      const dispatchCall = mockCouncil.dispatchReviews.mock.calls[0][0];
      expect(dispatchCall.code).toBe('diff --git a/test.ts');
      expect(dispatchCall.repoPath).toBe('/tmp/repo');
    });

    it('reviewFiles should not read file content and use relative paths', async () => {
      // Use real existing files so realpath validation succeeds
      const fileA = 'src/review/review.service.ts';
      const fileB = 'src/review/review.types.ts';
      const result = await service.reviewFiles([fileA, fileB]);
      expect(result.status).toBe('completed');
      // Should NOT call readFiles
      expect(mockCodeReader.readFiles).not.toHaveBeenCalled();

      // Should send relative filePaths (not absolute) to avoid leaking host paths
      const dispatchCall = mockCouncil.dispatchReviews.mock.calls[0][0];
      expect(dispatchCall.code).toBeUndefined();
      expect(dispatchCall.filePaths).toEqual([fileA, fileB]);
      expect(dispatchCall.repoPath).toBe(resolve('.'));

      // Decision maker should use explore mode with relative paths
      const exploreDecideCalls = mockDecisionMaker.decide.mock.calls[0];
      expect(exploreDecideCalls[0]).toBe(`${fileA}\n${fileB}`);
      expect(exploreDecideCalls[1]).toBeInstanceOf(Array);
      expect(exploreDecideCalls[2]).toBe('explore');
    });

    it('reviewCodebase should list files without reading content', async () => {
      const result = await service.reviewCodebase('/tmp/project');
      expect(result.status).toBe('completed');
      // Should call listCodebaseFiles, NOT readCodebase
      expect(mockCodeReader.listCodebaseFiles).toHaveBeenCalledWith(
        '/tmp/project',
        {},
      );
      expect(mockCodeReader.readCodebase).not.toHaveBeenCalled();

      // Should send filePaths and repoPath
      const dispatchCall = mockCouncil.dispatchReviews.mock.calls[0][0];
      expect(dispatchCall.code).toBeUndefined();
      expect(dispatchCall.repoPath).toBe('/tmp/project');
      expect(dispatchCall.filePaths).toEqual(['src/app.ts', 'src/main.ts']);

      // Decision maker should use explore mode
      const cbDecideCalls = mockDecisionMaker.decide.mock.calls[0];
      expect(cbDecideCalls[0]).toBe('src/app.ts\nsrc/main.ts');
      expect(cbDecideCalls[1]).toBeInstanceOf(Array);
      expect(cbDecideCalls[2]).toBe('explore');
    });

    it('should return partial result when decision maker fails in explore mode', async () => {
      mockDecisionMaker.decide.mockRejectedValue(new Error('DM timeout'));
      const result = await service.reviewCodebase('/tmp/project');
      expect(result.status).toBe('partial');
      expect(result.individualReviews.length).toBe(2);
      expect(result.decision).toBeUndefined();
    });
  });
});
