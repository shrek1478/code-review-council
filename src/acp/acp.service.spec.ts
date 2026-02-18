import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { AcpService } from './acp.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    const map: Record<string, string> = {
      copilot: '/usr/local/bin/copilot',
      gemini: '/usr/local/bin/gemini',
    };
    const resolved = map[args[0]];
    if (resolved) return resolved + '\n';
    throw new Error(`not found: ${args[0]}`);
  }),
}));

vi.mock('@shrek1478/copilot-sdk-with-acp', () => {
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
    const h1 = await service.createClient({
      name: 'R1',
      cliPath: 'cli1',
      cliArgs: [],
    });
    const h2 = await service.createClient({
      name: 'R2',
      cliPath: 'cli2',
      cliArgs: [],
    });

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
          callback({
            type: 'assistant.message',
            data: { content: 'Review result' },
          });
          callback({ type: 'session.idle', data: {} });
        }, 0);
      }),
      send: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    (handle.client as any).createSession = vi
      .fn()
      .mockResolvedValue(mockSession);

    const result = await service.sendPrompt(handle, 'Review this code');

    expect((handle.client as any).createSession).toHaveBeenCalledWith({
      model: 'gpt-5-mini',
      streaming: true,
    });
    expect(result).toBe('Review result');
    expect(mockSession.destroy).toHaveBeenCalled();
  });

  it('should preserve delta-accumulated content over assistant.message', async () => {
    const handle = await service.createClient({
      name: 'DeltaReviewer',
      cliPath: 'delta-cli',
      cliArgs: [],
    });

    const mockSession = {
      on: vi.fn((callback: (event: any) => void) => {
        setTimeout(() => {
          // Simulate streaming deltas
          callback({
            type: 'assistant.message_delta',
            data: { deltaContent: 'Hello ' },
          });
          callback({
            type: 'assistant.message_delta',
            data: { deltaContent: 'World' },
          });
          // assistant.message arrives after deltas — should NOT overwrite
          callback({
            type: 'assistant.message',
            data: { content: 'Stale content' },
          });
          callback({ type: 'session.idle', data: {} });
        }, 0);
      }),
      send: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    (handle.client as any).createSession = vi
      .fn()
      .mockResolvedValue(mockSession);

    const result = await service.sendPrompt(handle, 'Review this');
    expect(result).toBe('Hello World');
  });

  it('should use assistant.message content when no deltas were received', async () => {
    const handle = await service.createClient({
      name: 'NonDelta',
      cliPath: 'nondelta-cli',
      cliArgs: [],
    });

    const mockSession = {
      on: vi.fn((callback: (event: any) => void) => {
        setTimeout(() => {
          callback({
            type: 'assistant.message',
            data: { content: 'Full message' },
          });
          callback({ type: 'session.idle', data: {} });
        }, 0);
      }),
      send: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    (handle.client as any).createSession = vi
      .fn()
      .mockResolvedValue(mockSession);

    const result = await service.sendPrompt(handle, 'Review this');
    expect(result).toBe('Full message');
  });

  it('should call stopAll on module destroy', async () => {
    const h1 = await service.createClient({
      name: 'R1',
      cliPath: 'cli1',
      cliArgs: [],
    });
    await service.onModuleDestroy();
    expect(h1.client.stop).toHaveBeenCalled();
  });

  it('should pass protocol from config to CopilotClient', async () => {
    const { CopilotClient } = await import(
      '@shrek1478/copilot-sdk-with-acp'
    );
    const handle = await service.createClient({
      name: 'CopilotNative',
      cliPath: 'copilot',
      cliArgs: [],
      protocol: 'copilot',
      model: 'gpt-5-mini',
    });
    expect(handle).toBeDefined();
    expect(CopilotClient).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'copilot' }),
    );
  });

  it('should default protocol to acp when not specified', async () => {
    const { CopilotClient } = await import(
      '@shrek1478/copilot-sdk-with-acp'
    );
    await service.createClient({
      name: 'DefaultProtocol',
      cliPath: 'some-cli',
      cliArgs: [],
    });
    expect(CopilotClient).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'acp' }),
    );
  });

  it('should resolve command name to absolute path via which', async () => {
    const { CopilotClient } = await import(
      '@shrek1478/copilot-sdk-with-acp'
    );
    await service.createClient({
      name: 'Copilot',
      cliPath: 'copilot',
      cliArgs: [],
      protocol: 'copilot',
    });
    expect(CopilotClient).toHaveBeenCalledWith(
      expect.objectContaining({ cliPath: '/usr/local/bin/copilot' }),
    );
  });

  it('should keep absolute cliPath as-is without calling which', async () => {
    const { CopilotClient } = await import(
      '@shrek1478/copilot-sdk-with-acp'
    );
    await service.createClient({
      name: 'Test',
      cliPath: '/opt/bin/my-cli',
      cliArgs: [],
    });
    expect(CopilotClient).toHaveBeenCalledWith(
      expect.objectContaining({ cliPath: '/opt/bin/my-cli' }),
    );
  });

  it('should fall back to original cliPath when which fails', async () => {
    const { CopilotClient } = await import(
      '@shrek1478/copilot-sdk-with-acp'
    );
    await service.createClient({
      name: 'Unknown',
      cliPath: 'unknown-cli',
      cliArgs: [],
    });
    expect(CopilotClient).toHaveBeenCalledWith(
      expect.objectContaining({ cliPath: 'unknown-cli' }),
    );
  });

  it('should reject createClient after stopAll', async () => {
    await service.stopAll();
    await expect(
      service.createClient({ name: 'Late', cliPath: 'cli', cliArgs: [] }),
    ).rejects.toThrow('shutting down');
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

    (handle.client as any).createSession = vi
      .fn()
      .mockResolvedValue(mockSession);

    await expect(
      service.sendPrompt(handle, 'Review this code', 100),
    ).rejects.toThrow('SlowReviewer timed out after 100ms');

    expect(mockSession.destroy).toHaveBeenCalled();
  });
});
