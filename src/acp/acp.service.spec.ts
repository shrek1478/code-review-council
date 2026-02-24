import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { AcpService } from './acp.service.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile } from 'node:child_process';

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
      sendAndWait: vi.fn().mockResolvedValue({ data: { content: '' } }),
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
      on: vi.fn(),
      sendAndWait: vi.fn().mockResolvedValue({
        data: { content: 'Review result' },
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
      streaming: false,
    });
    expect(result).toBe('Review result');
    expect(mockSession.destroy).toHaveBeenCalled();
  });

  it('should invoke onDelta callback for streaming deltas via assistant.message_delta event', async () => {
    const handle = await service.createClient({
      name: 'DeltaReviewer',
      cliPath: 'delta-cli',
      cliArgs: [],
      streaming: true,
    });

    const deltaHandler = vi.fn();
    let deltaEventHandler: ((event: any) => void) | undefined;

    const mockSession = {
      on: vi.fn((eventName: string, handler: (event: any) => void) => {
        if (eventName === 'assistant.message_delta') {
          deltaEventHandler = handler;
        }
      }),
      sendAndWait: vi.fn().mockImplementation(async () => {
        // Fire delta events before resolving
        deltaEventHandler?.({ data: { deltaContent: 'Hello ' } });
        deltaEventHandler?.({ data: { deltaContent: 'World' } });
        return { data: { content: 'Hello World' } };
      }),
      send: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    (handle.client as any).createSession = vi
      .fn()
      .mockResolvedValue(mockSession);

    const result = await service.sendPrompt(handle, 'Review this', 5000, {
      onDelta: deltaHandler,
    });
    expect(result).toBe('Hello World');
    expect(deltaHandler).toHaveBeenCalledWith('Hello ');
    expect(deltaHandler).toHaveBeenCalledWith('World');
  });

  it('should return content from sendAndWait response', async () => {
    const handle = await service.createClient({
      name: 'NonDelta',
      cliPath: 'nondelta-cli',
      cliArgs: [],
    });

    const mockSession = {
      on: vi.fn(),
      sendAndWait: vi.fn().mockResolvedValue({
        data: { content: 'Full message' },
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
      sendAndWait: vi
        .fn()
        .mockRejectedValue(new Error('SlowReviewer timed out after 100ms')),
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

  describe('cleanupOrphanedProcesses', () => {
    let killSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    });

    afterEach(() => {
      killSpy.mockRestore();
    });

    function mockPgrep(pids: number[]): void {
      (vi.mocked(execFile) as any).mockImplementationOnce(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, pids.map(String).join('\n') + '\n', '');
        },
      );
    }

    function mockPgrepNotFound(): void {
      (vi.mocked(execFile) as any).mockImplementationOnce(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(new Error('no matches'), '', '');
        },
      );
    }

    /** Mock `ps -p <pid> -o command=` verification call to return given command string. */
    function mockPsVerify(command: string): void {
      (vi.mocked(execFile) as any).mockImplementationOnce(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, command + '\n', '');
        },
      );
    }

    it('should return 0 and kill nothing when no processes found', async () => {
      mockPgrepNotFound();
      const killed = await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      expect(killed).toBe(0);
      expect(killSpy).not.toHaveBeenCalled();
    });

    it('should kill found PIDs and return count', async () => {
      mockPgrep([11111, 22222]);
      mockPsVerify('codex-acp --experimental-acp');
      mockPsVerify('codex-acp');
      const killed = await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      expect(killed).toBe(2);
      expect(killSpy).toHaveBeenCalledWith(11111, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledWith(22222, 'SIGTERM');
    });

    it('should skip own process PID', async () => {
      mockPgrep([process.pid, 99999]);
      // Only 99999 gets verified (process.pid is skipped before ps check)
      mockPsVerify('codex-acp');
      const killed = await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      expect(killed).toBe(1);
      expect(killSpy).not.toHaveBeenCalledWith(process.pid, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledWith(99999, 'SIGTERM');
    });

    it('should not throw when kill fails (process already gone)', async () => {
      mockPgrep([55555]);
      mockPsVerify('codex-acp');
      killSpy.mockImplementation(() => {
        throw new Error('ESRCH: no such process');
      });
      const killed = await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      expect(killed).toBe(0);
    });

    it('should append --experimental-acp to pattern when present in cliArgs', async () => {
      let capturedArgs: string[] = [];
      (vi.mocked(execFile) as any).mockImplementationOnce(
        (_cmd: string, args: string[], _opts: unknown, cb: Function) => {
          capturedArgs = args;
          cb(null, '', '');
        },
      );
      await service.cleanupOrphanedProcesses([
        { name: 'Gemini', cliPath: 'gemini', cliArgs: ['--experimental-acp'] },
      ]);
      expect(capturedArgs).toEqual([
        '-f',
        '-P',
        '1',
        'gemini.*--experimental-acp',
      ]);
    });

    it('should use plain cliPath pattern when no --experimental-acp', async () => {
      let capturedArgs: string[] = [];
      (vi.mocked(execFile) as any).mockImplementationOnce(
        (_cmd: string, args: string[], _opts: unknown, cb: Function) => {
          capturedArgs = args;
          cb(null, '', '');
        },
      );
      await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      expect(capturedArgs).toEqual(['-f', '-P', '1', 'codex-acp']);
    });

    it('should deduplicate patterns from multiple configs with same cliPath', async () => {
      let callCount = 0;
      (vi.mocked(execFile) as any).mockImplementationOnce(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          callCount++;
          cb(null, '', '');
        },
      );
      await service.cleanupOrphanedProcesses([
        { name: 'Codex', cliPath: 'codex-acp', cliArgs: [] },
        { name: 'Codex2', cliPath: 'codex-acp', cliArgs: [] },
      ]);
      expect(callCount).toBe(1);
    });
  });
});
