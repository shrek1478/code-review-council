import { Test } from '@nestjs/testing';
import { SummarizerService } from './summarizer.service.js';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('SummarizerService', () => {
  let service: SummarizerService;
  const mockAcpService = {
    createClient: vi.fn().mockResolvedValue({ name: 'Summarizer', client: {} }),
    sendPrompt: vi.fn().mockResolvedValue(JSON.stringify({
      aggregatedReview: 'Code looks good overall.',
      issues: [
        {
          severity: 'medium',
          category: 'readability',
          description: 'Variable naming could be improved',
          agreedBy: ['Gemini', 'Claude'],
          suggestion: 'Use descriptive names',
        },
      ],
    })),
    stopAll: vi.fn().mockResolvedValue(undefined),
  };
  const mockConfigService = {
    getConfig: vi.fn().mockReturnValue({
      summarizer: { name: 'Claude', cliPath: 'claude-code-acp', cliArgs: [] },
      review: { language: 'zh-tw' },
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAcpService.createClient.mockResolvedValue({ name: 'Summarizer', client: {} });
    mockAcpService.sendPrompt.mockResolvedValue(JSON.stringify({
      aggregatedReview: 'Code looks good overall.',
      issues: [{
        severity: 'medium',
        category: 'readability',
        description: 'Variable naming could be improved',
        agreedBy: ['Gemini', 'Claude'],
        suggestion: 'Use descriptive names',
      }],
    }));

    const module = await Test.createTestingModule({
      providers: [
        SummarizerService,
        { provide: AcpService, useValue: mockAcpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get(SummarizerService);
  });

  it('should summarize individual reviews', async () => {
    const summary = await service.summarize([
      { reviewer: 'Gemini', review: 'Variable naming could be improved.' },
      { reviewer: 'Claude', review: 'Consider renaming variables for clarity.' },
    ]);
    expect(summary.reviewer).toContain('Claude');
    expect(summary.aggregatedReview).toBeDefined();
    expect(summary.issues.length).toBeGreaterThan(0);
  });

  it('should handle non-JSON response gracefully', async () => {
    mockAcpService.sendPrompt.mockResolvedValue('This is just plain text, not JSON.');
    const summary = await service.summarize([
      { reviewer: 'Gemini', review: 'Looks good.' },
    ]);
    expect(summary.aggregatedReview).toBe('This is just plain text, not JSON.');
    expect(summary.issues).toEqual([]);
  });
});
