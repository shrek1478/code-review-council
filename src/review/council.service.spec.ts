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

  it('should retry on timeout error and succeed on second attempt', async () => {
    mockConfigService.getConfig.mockReturnValue({
      reviewers: [
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [], maxRetries: 1 },
      ],
      review: { defaultChecks: ['code-quality'], language: 'zh-tw' },
    });
    mockAcpService.sendPrompt
      .mockRejectedValueOnce(new Error('Codex timed out after 180000ms'))
      .mockResolvedValueOnce('Review OK after retry');
    mockAcpService.createClient
      .mockResolvedValueOnce({ name: 'Codex', client: {} })
      .mockResolvedValueOnce({ name: 'Codex', client: {} });

    const reviews = await service.dispatchReviews({
      code: 'const x = 1;',
      checks: ['code-quality'],
    });

    expect(reviews.length).toBe(1);
    expect(reviews[0].review).toBe('Review OK after retry');
    expect(mockAcpService.createClient).toHaveBeenCalledTimes(2);
    expect(mockAcpService.stopClient).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-retryable errors', async () => {
    mockConfigService.getConfig.mockReturnValue({
      reviewers: [
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [], maxRetries: 2 },
      ],
      review: { defaultChecks: ['code-quality'], language: 'zh-tw' },
    });
    mockAcpService.sendPrompt
      .mockRejectedValueOnce(new Error('Invalid token'));

    const reviews = await service.dispatchReviews({
      code: 'const x = 1;',
      checks: ['code-quality'],
    });

    expect(reviews.length).toBe(1);
    expect(reviews[0].review).toContain('error');
    expect(mockAcpService.sendPrompt).toHaveBeenCalledTimes(1);
  });

  it('should pass configured timeoutMs to sendPrompt', async () => {
    mockConfigService.getConfig.mockReturnValue({
      reviewers: [
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [], timeoutMs: 300000 },
      ],
      review: { defaultChecks: ['code-quality'], language: 'zh-tw' },
    });

    await service.dispatchReviews({
      code: 'const x = 1;',
      checks: ['code-quality'],
    });

    expect(mockAcpService.sendPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      300000,
    );
  });

  it('should include no-tools instruction when allowLocalExploration is false', async () => {
    mockConfigService.getConfig.mockReturnValue({
      reviewers: [
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ],
      review: { defaultChecks: ['code-quality'], language: 'zh-tw', allowLocalExploration: false },
    });

    await service.dispatchReviews({
      code: 'const x = 1;',
      checks: ['code-quality'],
    });

    const promptArg = mockAcpService.sendPrompt.mock.calls[0][1] as string;
    expect(promptArg).toContain('Do NOT use any tools');
    expect(promptArg).not.toContain('You MAY use available tools');
  });

  it('should include explore instruction when allowLocalExploration is true', async () => {
    mockConfigService.getConfig.mockReturnValue({
      reviewers: [
        { name: 'Gemini', cliPath: 'gemini', cliArgs: [] },
      ],
      review: { defaultChecks: ['code-quality'], language: 'zh-tw', allowLocalExploration: true },
    });

    await service.dispatchReviews({
      code: 'const x = 1;',
      checks: ['code-quality'],
    });

    const promptArg = mockAcpService.sendPrompt.mock.calls[0][1] as string;
    expect(promptArg).toContain('You MAY use available tools');
    expect(promptArg).not.toContain('Do NOT use any tools');
  });

  it('should default to no-tools when allowLocalExploration is undefined', async () => {
    await service.dispatchReviews({
      code: 'const x = 1;',
      checks: ['code-quality'],
    });

    const promptArg = mockAcpService.sendPrompt.mock.calls[0][1] as string;
    expect(promptArg).toContain('Do NOT use any tools');
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
