import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { CouncilService } from './council.service.js';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('CouncilService', () => {
  let service: CouncilService;
  const mockAcpService = {
    createClient: vi.fn().mockResolvedValue({ name: 'MockReviewer', client: {} }),
    sendPrompt: vi.fn().mockResolvedValue('No issues found.'),
    stopClient: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn().mockResolvedValue(undefined),
  };
  const mockConfigService = {
    getConfig: vi.fn().mockReturnValue({
      reviewers: [
        { name: 'Gemini', cliPath: 'gemini', cliArgs: ['--experimental-acp'] },
        { name: 'Claude', cliPath: 'claude-code-acp', cliArgs: [] },
      ],
      review: { defaultChecks: ['code-quality'], language: 'zh-tw' },
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAcpService.createClient.mockResolvedValue({ name: 'MockReviewer', client: {} });
    mockAcpService.sendPrompt.mockResolvedValue('No issues found.');
    mockAcpService.stopAll.mockResolvedValue(undefined);
    mockConfigService.getConfig.mockReturnValue({
      reviewers: [
        { name: 'Gemini', cliPath: 'gemini', cliArgs: ['--experimental-acp'] },
        { name: 'Claude', cliPath: 'claude-code-acp', cliArgs: [] },
      ],
      review: { defaultChecks: ['code-quality'], language: 'zh-tw' },
    });
    const module = await Test.createTestingModule({
      providers: [
        CouncilService,
        { provide: ConsoleLogger, useValue: new ConsoleLogger() },
        { provide: AcpService, useValue: mockAcpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get(CouncilService);
  });

  it('should dispatch reviews to all configured reviewers in parallel', async () => {
    const reviews = await service.dispatchReviews({
      code: 'const x = 1;',
      checks: ['code-quality'],
    });
    expect(reviews.length).toBe(2);
    expect(mockAcpService.createClient).toHaveBeenCalledTimes(2);
    expect(mockAcpService.sendPrompt).toHaveBeenCalledTimes(2);
  });

  it('should handle reviewer failure gracefully', async () => {
    mockAcpService.sendPrompt
      .mockResolvedValueOnce('OK')
      .mockRejectedValueOnce(new Error('timeout'));
    const reviews = await service.dispatchReviews({
      code: 'const x = 1;',
      checks: ['code-quality'],
    });
    expect(reviews.length).toBe(2);
    expect(reviews[1].review).toContain('error');
  });

  it('should stop clients for failed reviewers', async () => {
    mockAcpService.createClient
      .mockResolvedValueOnce({ name: 'Gemini', client: {} })
      .mockRejectedValueOnce(new Error('client start failed'));

    const reviews = await service.dispatchReviews({
      code: 'const x = 1;',
      checks: ['code-quality'],
    });

    expect(reviews.length).toBe(2);
    expect(reviews[1].review).toContain('error');
    expect(mockAcpService.createClient).toHaveBeenCalledTimes(2);
  });
});
