import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { AcpService } from './acp.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@github/copilot-sdk', () => {
  const MockCopilotClient = vi.fn().mockImplementation(function (this: any) {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn().mockResolvedValue(undefined);
    this.createSession = vi.fn().mockResolvedValue({
      on: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
  });
  return { CopilotClient: MockCopilotClient };
});

describe('AcpService', () => {
  let service: AcpService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AcpService,
        { provide: ConsoleLogger, useValue: new ConsoleLogger() },
      ],
    }).compile();
    service = module.get(AcpService);
  });

  it('should create a client for a reviewer config', async () => {
    const handle = await service.createClient({
      name: 'TestReviewer',
      cliPath: 'test-cli',
      cliArgs: ['--test'],
    });
    expect(handle).toBeDefined();
    expect(handle.name).toBe('TestReviewer');
    expect(handle.client).toBeDefined();
  });

  it('should preserve model from config in handle', async () => {
    const handle = await service.createClient({
      name: 'Copilot',
      cliPath: 'copilot',
      cliArgs: [],
      model: 'gpt-5-mini',
    });
    expect(handle.model).toBe('gpt-5-mini');
  });

  it('should leave model undefined when config has no model', async () => {
    const handle = await service.createClient({
      name: 'Codex',
      cliPath: 'codex-acp',
      cliArgs: [],
    });
    expect(handle.model).toBeUndefined();
  });

  it('should track and stop all created clients', async () => {
    const h1 = await service.createClient({ name: 'R1', cliPath: 'cli1', cliArgs: [] });
    const h2 = await service.createClient({ name: 'R2', cliPath: 'cli2', cliArgs: [] });

    await service.stopAll();

    expect(h1.client.stop).toHaveBeenCalled();
    expect(h2.client.stop).toHaveBeenCalled();
  });

  it('should pass model and streaming to createSession in sendPrompt', async () => {
    const handle = await service.createClient({
      name: 'Copilot',
      cliPath: 'copilot',
      cliArgs: [],
      model: 'gpt-5-mini',
    });

    const mockSession = {
      on: vi.fn((callback: (event: any) => void) => {
        setTimeout(() => {
          callback({ type: 'assistant.message', data: { content: 'Review result' } });
          callback({ type: 'session.idle', data: {} });
        }, 0);
      }),
      send: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    (handle.client as any).createSession = vi.fn().mockResolvedValue(mockSession);

    const result = await service.sendPrompt(handle, 'Review this code');

    expect((handle.client as any).createSession).toHaveBeenCalledWith({
      model: 'gpt-5-mini',
      streaming: true,
    });
    expect(result).toBe('Review result');
    expect(mockSession.destroy).toHaveBeenCalled();
  });

  it('should reject with timeout when session never responds', async () => {
    const handle = await service.createClient({
      name: 'SlowReviewer',
      cliPath: 'slow-cli',
      cliArgs: [],
    });

    const mockSession = {
      on: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    (handle.client as any).createSession = vi.fn().mockResolvedValue(mockSession);

    await expect(
      service.sendPrompt(handle, 'Review this code', 100),
    ).rejects.toThrow('SlowReviewer timed out after 100ms');

    expect(mockSession.destroy).toHaveBeenCalled();
  });
});
