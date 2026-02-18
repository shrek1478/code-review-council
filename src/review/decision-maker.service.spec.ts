import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { DecisionMakerService } from './decision-maker.service.js';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('DecisionMakerService', () => {
  let service: DecisionMakerService;
  const mockAcpService = {
    createClient: vi
      .fn()
      .mockResolvedValue({ name: 'DecisionMaker', client: {} }),
    sendPrompt: vi.fn().mockResolvedValue(
      JSON.stringify({
        overallAssessment: 'Code is well-structured overall.',
        decisions: [
          {
            severity: 'medium',
            category: 'readability',
            description: 'Variable naming could be improved',
            raisedBy: ['Gemini', 'Codex'],
            verdict: 'accepted',
            reasoning: 'Both reviewers agree, and the naming is indeed unclear',
            suggestion: 'Use descriptive names',
          },
        ],
        additionalFindings: [
          {
            severity: 'low',
            category: 'best-practices',
            description: 'Missing error handling in async function',
            suggestion: 'Add try-catch block',
          },
        ],
      }),
    ),
    stopClient: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn().mockResolvedValue(undefined),
  };
  const mockConfigService = {
    getConfig: vi.fn().mockReturnValue({
      decisionMaker: {
        name: 'Claude',
        cliPath: 'claude-code-acp',
        cliArgs: [],
      },
      review: { language: 'zh-tw' },
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAcpService.createClient.mockResolvedValue({
      name: 'DecisionMaker',
      client: {},
    });
    mockAcpService.sendPrompt.mockResolvedValue(
      JSON.stringify({
        overallAssessment: 'Code is well-structured overall.',
        decisions: [
          {
            severity: 'medium',
            category: 'readability',
            description: 'Variable naming could be improved',
            raisedBy: ['Gemini', 'Codex'],
            verdict: 'accepted',
            reasoning: 'Both reviewers agree',
            suggestion: 'Use descriptive names',
          },
        ],
        additionalFindings: [],
      }),
    );

    const module = await Test.createTestingModule({
      providers: [
        DecisionMakerService,
        { provide: ConsoleLogger, useValue: new ConsoleLogger() },
        { provide: AcpService, useValue: mockAcpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get(DecisionMakerService);
  });

  it('should decide based on code and reviewer opinions', async () => {
    const decision = await service.decide('const x = 1;', [
      { reviewer: 'Gemini', review: 'Variable naming could be improved.' },
      { reviewer: 'Codex', review: 'Consider renaming variables for clarity.' },
    ]);
    expect(decision.reviewer).toContain('Claude');
    expect(decision.reviewer).toContain('Decision Maker');
    expect(decision.overallAssessment).toBeDefined();
    expect(decision.decisions.length).toBeGreaterThan(0);

    // Verify the prompt includes both code and reviews
    const sentPrompt = mockAcpService.sendPrompt.mock.calls[0][1];
    expect(sentPrompt).toContain('const x = 1;');
    expect(sentPrompt).toContain('=== Gemini ===');
    expect(sentPrompt).toContain('=== Codex ===');
  });

  it('should handle non-JSON response gracefully', async () => {
    mockAcpService.sendPrompt.mockResolvedValue(
      'This is just plain text, not JSON.',
    );
    const decision = await service.decide('const x = 1;', [
      { reviewer: 'Gemini', review: 'Looks good.' },
    ]);
    expect(decision.overallAssessment).toBe(
      '[PARSE_FAILED] This is just plain text, not JSON.',
    );
    expect(decision.decisions).toEqual([]);
    expect(decision.additionalFindings).toEqual([]);
  });

  it('should parse JSON embedded in text with markdown fences', async () => {
    const jsonObj = {
      overallAssessment: 'Good code.',
      decisions: [],
      additionalFindings: [],
    };
    mockAcpService.sendPrompt.mockResolvedValue(
      'Here is my analysis:\n```json\n' +
        JSON.stringify(jsonObj) +
        '\n```\nEnd.',
    );
    const decision = await service.decide('const x = 1;', [
      { reviewer: 'Test', review: 'OK' },
    ]);
    expect(decision.overallAssessment).toBe('Good code.');
  });

  it('should use summary mode prompt when isSummaryMode is true', async () => {
    await service.decide(
      'file1.ts (10 lines)\nfile2.ts (20 lines)',
      [{ reviewer: 'Test', review: 'OK' }],
      true,
    );
    const sentPrompt = mockAcpService.sendPrompt.mock.calls[0][1];
    expect(sentPrompt).toContain('file summary');
    expect(sentPrompt).not.toContain('Review the code yourself');
  });

  it('should use config maxReviewsLength for truncation', async () => {
    mockConfigService.getConfig.mockReturnValue({
      decisionMaker: {
        name: 'Claude',
        cliPath: 'claude-code-acp',
        cliArgs: [],
      },
      review: { language: 'zh-tw', maxReviewsLength: 100 },
    });
    const longReview = 'x'.repeat(500);
    await service.decide('const x = 1;', [
      { reviewer: 'Test', review: longReview },
    ]);
    const sentPrompt = mockAcpService.sendPrompt.mock.calls[0][1];
    expect(sentPrompt).toContain('truncated');
  });

  it('should use config timeoutMs for decision maker', async () => {
    mockConfigService.getConfig.mockReturnValue({
      decisionMaker: {
        name: 'Claude',
        cliPath: 'claude-code-acp',
        cliArgs: [],
        timeoutMs: 600000,
      },
      review: { language: 'zh-tw' },
    });
    await service.decide('const x = 1;', [{ reviewer: 'Test', review: 'OK' }]);
    expect(mockAcpService.sendPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      600000,
    );
  });

  it('should fallback invalid category to other and reject invalid line', async () => {
    mockAcpService.sendPrompt.mockResolvedValue(
      JSON.stringify({
        overallAssessment: 'OK',
        decisions: [
          {
            severity: 'medium',
            category: 'unknown-cat',
            description: 'Test',
            line: -5,
            raisedBy: [],
            verdict: 'accepted',
            reasoning: 'test',
            suggestion: 'test',
          },
          {
            severity: 'low',
            category: 'security',
            description: 'Valid category',
            line: 42,
            raisedBy: [],
            verdict: 'accepted',
            reasoning: 'ok',
            suggestion: 'ok',
          },
          {
            severity: 'low',
            category: 'performance',
            description: 'Float line',
            line: 3.5,
            raisedBy: [],
            verdict: 'accepted',
            reasoning: 'ok',
            suggestion: 'ok',
          },
        ],
        additionalFindings: [
          {
            severity: 'low',
            category: 'invented',
            description: 'Bad cat finding',
            suggestion: 'fix',
          },
        ],
      }),
    );
    const decision = await service.decide('const x = 1;', [
      { reviewer: 'Test', review: 'OK' },
    ]);
    expect(decision.decisions[0].category).toBe('other');
    expect(decision.decisions[0].line).toBeUndefined();
    expect(decision.decisions[1].category).toBe('security');
    expect(decision.decisions[1].line).toBe(42);
    expect(decision.decisions[2].line).toBeUndefined();
    expect(decision.additionalFindings[0].category).toBe('other');
  });

  it('should retry on timeout and succeed on second attempt', async () => {
    mockConfigService.getConfig.mockReturnValue({
      decisionMaker: {
        name: 'Claude',
        cliPath: 'claude-code-acp',
        cliArgs: [],
        maxRetries: 1,
      },
      review: { language: 'zh-tw' },
    });
    mockAcpService.sendPrompt
      .mockRejectedValueOnce(new Error('Claude timed out after 300000ms'))
      .mockResolvedValueOnce(
        JSON.stringify({
          overallAssessment: 'OK after retry',
          decisions: [],
          additionalFindings: [],
        }),
      );
    mockAcpService.createClient
      .mockResolvedValueOnce({ name: 'Claude', client: {} })
      .mockResolvedValueOnce({ name: 'Claude', client: {} });

    const decision = await service.decide('const x = 1;', [
      { reviewer: 'Test', review: 'OK' },
    ]);
    expect(decision.overallAssessment).toBe('OK after retry');
    expect(mockAcpService.createClient).toHaveBeenCalledTimes(2);
  });
});
