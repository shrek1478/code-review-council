import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { AcpService } from './acp.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout?: string, stderr?: string) => void,
    ) => {
      const map: Record<string, string> = {
        copilot: '/usr/local/bin/copilot',
        gemini: '/usr/local/bin/gemini',
      };
      const resolved = map[args[0]];
      if (resolved) {
        cb(null, resolved + '\n', '');
      } else {
        cb(new Error(`not found: ${args[0]}`));
      }
    },
  ),
}));

vi.mock('@shrek1478/copilot-sdk-with-acp', () => {
  const MockCopilotClient = vi.fn().mockImplementation(function (this: any) {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn().mockResolvedValue(undefined);
    this.forceStop = vi.fn().mockResolvedValue(undefined);
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

  it('should forceStop when graceful stop hangs', async () => {
    vi.useFakeTimers();
    try {
      const handle = await service.createClient({
        name: 'HangingCli',
        cliPath: 'hanging-cli',
        cliArgs: [],
      });

      // Make stop() never resolve
      (handle.client.stop as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise(() => {}),
      );

      const stopPromise = service.stopClient(handle);
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;

      expect(handle.client.stop).toHaveBeenCalled();
      expect((handle.client as any).forceStop).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should not forceStop when graceful stop succeeds', async () => {
    const handle = await service.createClient({
      name: 'GoodCli',
      cliPath: 'good-cli',
      cliArgs: [],
    });

    await service.stopClient(handle);

    expect(handle.client.stop).toHaveBeenCalled();
    expect((handle.client as any).forceStop).not.toHaveBeenCalled();
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
    const { CopilotClient } = await import('@shrek1478/copilot-sdk-with-acp');
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
    const { CopilotClient } = await import('@shrek1478/copilot-sdk-with-acp');
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
    const { CopilotClient } = await import('@shrek1478/copilot-sdk-with-acp');
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

  it('should reject absolute cliPath as unsafe', async () => {
    await expect(
      service.createClient({
        name: 'Test',
        cliPath: '/opt/bin/my-cli',
        cliArgs: [],
      }),
    ).rejects.toThrow('Unsafe cliPath rejected');
  });

  it('should reject cliPath with path separators', async () => {
    await expect(
      service.createClient({
        name: 'Test',
        cliPath: '../bin/evil',
        cliArgs: [],
      }),
    ).rejects.toThrow('Unsafe cliPath rejected');
  });

  it('should reject cliPath "." and ".."', async () => {
    await expect(
      service.createClient({ name: 'Dot', cliPath: '.', cliArgs: [] }),
    ).rejects.toThrow('Unsafe cliPath rejected');
    await expect(
      service.createClient({ name: 'DotDot', cliPath: '..', cliArgs: [] }),
    ).rejects.toThrow('Unsafe cliPath rejected');
  });

  it('should reject cliPath starting with a dash', async () => {
    await expect(
      service.createClient({
        name: 'Test',
        cliPath: '-malicious',
        cliArgs: [],
      }),
    ).rejects.toThrow('Unsafe cliPath rejected');
  });

  it('should fall back to original cliPath when which fails', async () => {
    const { CopilotClient } = await import('@shrek1478/copilot-sdk-with-acp');
    await service.createClient({
      name: 'Unknown',
      cliPath: 'unknown-cli',
      cliArgs: [],
    });
    expect(CopilotClient).toHaveBeenCalledWith(
      expect.objectContaining({ cliPath: 'unknown-cli' }),
    );
  });

  describe('maskSensitiveArgs (via createClient log output)', () => {
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      logSpy = vi.fn();
      (service as any).logger.log = logSpy;
    });

    it('should mask values after sensitive flags', async () => {
      await service.createClient({
        name: 'Test',
        cliPath: 'test-cli',
        cliArgs: ['--api-key', 'super-secret-key-12345', '--verbose'],
      });
      const logMsg = logSpy.mock.calls[0][0] as string;
      expect(logMsg).toContain('[REDACTED]');
      expect(logMsg).not.toContain('super-secret-key-12345');
      expect(logMsg).toContain('--verbose');
    });

    it('should mask flag=value style sensitive args', async () => {
      await service.createClient({
        name: 'Test',
        cliPath: 'test-cli',
        cliArgs: ['--token=ghp_abcdef1234567890abcdef1234567890ab'],
      });
      const logMsg = logSpy.mock.calls[0][0] as string;
      expect(logMsg).toContain('--token=[REDACTED]');
      expect(logMsg).not.toContain('ghp_');
    });

    it('should mask standalone positional args that look like secrets', async () => {
      const base64Token = 'A'.repeat(40);
      await service.createClient({
        name: 'Test',
        cliPath: 'test-cli',
        cliArgs: [base64Token],
      });
      const logMsg = logSpy.mock.calls[0][0] as string;
      expect(logMsg).toContain('[REDACTED]');
      expect(logMsg).not.toContain(base64Token);
    });

    it('should mask common secret prefixes (sk-, ghp_, glpat-)', async () => {
      await service.createClient({
        name: 'Test',
        cliPath: 'test-cli',
        cliArgs: ['key=sk-abc12345678'],
      });
      const logMsg = logSpy.mock.calls[0][0] as string;
      expect(logMsg).toContain('[REDACTED]');
      expect(logMsg).not.toContain('sk-abc');
    });

    it('should leave short safe args untouched', async () => {
      await service.createClient({
        name: 'Test',
        cliPath: 'test-cli',
        cliArgs: ['--verbose', '--format', 'json'],
      });
      const logMsg = logSpy.mock.calls[0][0] as string;
      expect(logMsg).toContain('--verbose');
      expect(logMsg).toContain('--format');
      expect(logMsg).toContain('json');
      expect(logMsg).not.toContain('[REDACTED]');
    });

    it('should tag overly long values with [REDACTED:length]', async () => {
      const longValue = 'A'.repeat(250);
      await service.createClient({
        name: 'Test',
        cliPath: 'test-cli',
        cliArgs: [longValue],
      });
      const logMsg = logSpy.mock.calls[0][0] as string;
      expect(logMsg).toContain('[REDACTED:length]');
    });

    it('should mask multiple sensitive flags in the same args list', async () => {
      await service.createClient({
        name: 'Test',
        cliPath: 'test-cli',
        cliArgs: ['--api-key', 'key123', '--token', 'tok456', '--debug'],
      });
      const logMsg = logSpy.mock.calls[0][0] as string;
      expect(logMsg).not.toContain('key123');
      expect(logMsg).not.toContain('tok456');
      expect(logMsg).toContain('--debug');
    });
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
