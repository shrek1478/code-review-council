import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { DecisionMakerService } from './decision-maker.service.js';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('DecisionMakerService', () => {
  let service: DecisionMakerService;
  const mockAcpService = {
    createClient: vi.fn().mockResolvedValue({ name: 'DecisionMaker', client: {} }),
    sendPrompt: vi.fn().mockResolvedValue(JSON.stringify({
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
    })),
    stopAll: vi.fn().mockResolvedValue(undefined),
  };
  const mockConfigService = {
    getConfig: vi.fn().mockReturnValue({
      decisionMaker: { name: 'Claude', cliPath: 'claude-code-acp', cliArgs: [] },
      review: { language: 'zh-tw' },
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAcpService.createClient.mockResolvedValue({ name: 'DecisionMaker', client: {} });
    mockAcpService.sendPrompt.mockResolvedValue(JSON.stringify({
      overallAssessment: 'Code is well-structured overall.',
      decisions: [{
        severity: 'medium',
        category: 'readability',
        description: 'Variable naming could be improved',
        raisedBy: ['Gemini', 'Codex'],
        verdict: 'accepted',
        reasoning: 'Both reviewers agree',
        suggestion: 'Use descriptive names',
      }],
      additionalFindings: [],
    }));

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
    const decision = await service.decide(
      'const x = 1;',
      [
        { reviewer: 'Gemini', review: 'Variable naming could be improved.' },
        { reviewer: 'Codex', review: 'Consider renaming variables for clarity.' },
      ],
    );
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
    mockAcpService.sendPrompt.mockResolvedValue('This is just plain text, not JSON.');
    const decision = await service.decide(
      'const x = 1;',
      [{ reviewer: 'Gemini', review: 'Looks good.' }],
    );
    expect(decision.overallAssessment).toBe('This is just plain text, not JSON.');
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
      'Here is my analysis:\n```json\n' + JSON.stringify(jsonObj) + '\n```\nEnd.'
    );
    const decision = await service.decide(
      'const x = 1;',
      [{ reviewer: 'Test', review: 'OK' }],
    );
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
});
