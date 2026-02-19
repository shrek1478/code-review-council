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
  const mockConfigService = {
    getConfig: vi.fn().mockReturnValue({
      review: { mode: 'inline' },
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
    mockCodeReader.listCodebaseFiles.mockResolvedValue([
      'src/app.ts',
      'src/main.ts',
    ]);
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
    mockConfigService.getConfig.mockReturnValue({
      review: { mode: 'inline' },
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
    expect(mockDecisionMaker.decide).toHaveBeenCalledWith(
      'diff --git a/test.ts',
      expect.arrayContaining([expect.objectContaining({ reviewer: 'Gemini' })]),
    );
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
    // 2 batches * 2 reviewers = 4 individual reviews
    expect(result.individualReviews.length).toBe(4);
    expect(mockDecisionMaker.decide).toHaveBeenCalledWith(
      expect.stringContaining('a.ts'),
      expect.any(Array),
      'batch',
    );
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
      // 3 batches * 2 reviewers each = 6 individual reviews
      expect(result.individualReviews.length).toBe(6);
      expect(mockDecisionMaker.decide).toHaveBeenCalledTimes(1);

      // Decision maker receives file summary (not full code) in multi-batch mode
      const decideCalls = mockDecisionMaker.decide.mock.calls[0];
      expect(decideCalls[0]).toContain('batch1.ts');
      expect(decideCalls[0]).toContain('lines');
      expect(decideCalls[2]).toBe('batch');
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
      expect(mockDecisionMaker.decide).toHaveBeenCalledWith(
        `${fileA}\n${fileB}`,
        expect.any(Array),
        'explore',
      );
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
      expect(mockDecisionMaker.decide).toHaveBeenCalledWith(
        'src/app.ts\nsrc/main.ts',
        expect.any(Array),
        'explore',
      );
    });
  });
});
