import {
  Inject,
  Injectable,
  ConsoleLogger,
  OnModuleDestroy,
} from '@nestjs/common';
import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import {
  CopilotClient,
  type CopilotClientOptions,
  type SessionConfig,
} from '@shrek1478/copilot-sdk-with-acp';
import { ReviewerConfig } from '../config/config.types.js';
import { sanitizeErrorMessage } from '../review/retry-utils.js';

export interface SendPromptOptions {
  onDelta?: (delta: string) => void;
  onToolActivity?: (toolName: string, args?: unknown) => void;
}

export interface AcpClientHandle {
  name: string;
  client: CopilotClient;
  model?: string;
  streaming?: boolean;
  cwd?: string;
}

@Injectable()
export class AcpService implements OnModuleDestroy {
  private clients = new Set<AcpClientHandle>();
  private stopping = false;
  private resolvedPaths = new Map<string, string>();

  constructor(@Inject(ConsoleLogger) private readonly logger: ConsoleLogger) {
    this.logger.setContext(AcpService.name);
  }

  private maskSensitiveArgs(args: string[]): string[] {
    const sensitiveFlags = new Set([
      '--api-key',
      '--token',
      '--secret',
      '--password',
      '--auth',
      '--bearer-token',
      '--client-secret',
      '--access-token',
      '--refresh-token',
      '--credentials',
      '-k',
      '-p',
    ]);
    return args.map((arg, i) => {
      if (i > 0 && sensitiveFlags.has(args[i - 1])) return '[REDACTED]';
      for (const flag of sensitiveFlags) {
        if (arg.startsWith(`${flag}=`)) return `${flag}=[REDACTED]`;
      }
      // Generic pattern: mask key=value where value looks like a secret
      if (arg.includes('=')) {
        const eqIdx = arg.indexOf('=');
        const value = arg.slice(eqIdx + 1);
        if (this.looksLikeSecret(value)) {
          const tag = value.length > 200 ? '[REDACTED:length]' : '[REDACTED]';
          return `${arg.slice(0, eqIdx + 1)}${tag}`;
        }
      }
      // Mask standalone positional args that look like secrets (tokens, API keys)
      if (!arg.startsWith('-') && this.looksLikeSecret(arg)) {
        return arg.length > 200 ? '[REDACTED:length]' : '[REDACTED]';
      }
      return arg;
    });
  }

  private looksLikeSecret(value: string): boolean {
    if (value.length < 8 || value.length > 200) return value.length > 200;
    // Common secret prefixes
    if (/^(sk-|ghp_|gho_|ghu_|ghs_|ghr_|glpat-|xox[bsrap]-)/i.test(value))
      return true;
    // Base64-like long strings (32+ chars, alphanumeric with +/= padding)
    if (value.length >= 32 && /^[A-Za-z0-9+/=_-]+$/.test(value)) return true;
    // Long hex strings (64+ chars) — common API key format
    if (value.length >= 64 && /^[0-9a-f]+$/i.test(value)) return true;
    return false;
  }

  private static readonly CLI_RESOLVE_TIMEOUT_MS = 5_000;
  private static readonly SAFE_CLI_NAME = /^(?!-)[A-Za-z0-9._-]+$/;

  async createClient(config: ReviewerConfig, cwd?: string): Promise<AcpClientHandle> {
    if (this.stopping) {
      throw new Error('Cannot create client: AcpService is shutting down');
    }
    if (
      !config.cliPath ||
      !AcpService.SAFE_CLI_NAME.test(config.cliPath) ||
      config.cliPath === '.' ||
      config.cliPath === '..'
    ) {
      throw new Error(
        `Unsafe cliPath rejected: "${config.cliPath}". Only simple command names are allowed.`,
      );
    }
    const cliPath = await this.resolveCliPath(config.cliPath);
    const modelInfo = config.model ? ` [model: ${config.model}]` : '';
    const maskedArgs = this.maskSensitiveArgs(config.cliArgs);
    const argsInfo = maskedArgs.length > 0 ? ` ${maskedArgs.join(' ')}` : '';
    this.logger.log(
      `Creating ACP client: ${config.name} (${cliPath}${argsInfo})${modelInfo}`,
    );
    const opts: CopilotClientOptions = {
      cliPath,
      cliArgs: config.cliArgs,
      protocol: config.protocol ?? 'acp',
      ...(cwd ? { cwd } : {}),
    };
    const client = new CopilotClient(opts);
    await client.start();
    const handle: AcpClientHandle = {
      name: config.name,
      client,
      model: config.model,
      streaming: config.streaming,
      cwd,
    };
    this.clients.add(handle);
    return handle;
  }

  /**
   * Resolve a CLI command name to its absolute path (cached).
   * - Absolute paths: returned as-is (defensive fallback only; createClient's
   *   SAFE_CLI_NAME guard restricts user-facing cliPath to bare command names).
   * - Bare command names are resolved via `which` (Unix/macOS) or `where` (Windows);
   *   falls back to original on failure.
   * - On Windows, `where` may return multiple matches; the first line is used.
   */
  private resolveCliPath(cliPath: string): Promise<string> {
    if (isAbsolute(cliPath)) return Promise.resolve(cliPath);
    const cached = this.resolvedPaths.get(cliPath);
    if (cached) return Promise.resolve(cached);
    const lookupCmd = process.platform === 'win32' ? 'where' : 'which';
    return new Promise<string>((resolve) => {
      try {
        execFile(lookupCmd, [cliPath], { encoding: 'utf-8', timeout: AcpService.CLI_RESOLVE_TIMEOUT_MS }, (err, stdout) => {
          if (err) {
            this.logger.warn(
              `Could not resolve "${cliPath}" via ${lookupCmd}, using as-is. Ensure the CLI tool is installed and in your PATH.`,
            );
            this.resolvedPaths.set(cliPath, cliPath);
            resolve(cliPath);
            return;
          }
          // `where` may return multiple matches (one per line); use the first non-empty line
          const resolved =
            stdout
              .split('\n')
              .map((l) => l.trim())
              .find((l) => l.length > 0) ?? cliPath;
          if (resolved.includes('\0')) {
            this.logger.warn(
              `Resolved path for "${cliPath}" contains null bytes, using original`,
            );
            this.resolvedPaths.set(cliPath, cliPath);
            resolve(cliPath);
            return;
          }
          this.resolvedPaths.set(cliPath, resolved);
          resolve(resolved);
        });
      } catch {
        // execFile may throw synchronously (e.g. ENOENT for the lookup command itself)
        this.resolvedPaths.set(cliPath, cliPath);
        resolve(cliPath);
      }
    });
  }

  async sendPrompt(
    handle: AcpClientHandle,
    prompt: string,
    timeoutMs = 180_000,
    options?: SendPromptOptions,
  ): Promise<string> {
    const sendStartMs = Date.now();
    this.logger.log(`[SEND] ${handle.name} reviewing...`);

    const streaming = handle.streaming !== false; // 預設 true
    const sessionOpts: SessionConfig = { streaming };
    if (handle.model) sessionOpts.model = handle.model;
    if (handle.cwd) sessionOpts.workingDirectory = handle.cwd;
    const session = await handle.client.createSession(sessionOpts);

    let deltaCount = 0;

    // 串流模式：監聽 message_delta 即時推送
    session.on('assistant.message_delta', (event) => {
      if (!streaming) return;
      const delta = event.data.deltaContent || '';
      if (delta) {
        deltaCount++;
        if (deltaCount === 1) {
          this.logger.log(`[DELTA] ${handle.name} first delta received`);
        }
        options?.onDelta?.(delta);
      }
    });

    // 非串流模式：監聽 assistant.message 取得完整回應後推送一次
    session.on('assistant.message', (event) => {
      if (streaming) return;
      const content = event.data.content || '';
      if (content) {
        deltaCount++;
        options?.onDelta?.(content);
      }
    });

    // 註冊 tool 活動事件（顯示 agent 正在讀哪個檔案）
    session.on('tool.execution_start', (event) => {
      const { toolName, arguments: toolArgs } = event.data;
      options?.onToolActivity?.(toolName, toolArgs);
    });

    // 註冊 usage 事件（記錄 model、token 使用量）
    session.on('assistant.usage', (event) => {
      const { model, inputTokens, outputTokens } = event.data;
      if (model) {
        this.logger.log(
          `[MODEL] ${handle.name} model: ${model} (in: ${inputTokens ?? '?'}, out: ${outputTokens ?? '?'})`,
        );
      }
    });

    try {
      const response = await session.sendAndWait({ prompt }, timeoutMs);
      const content = response?.data?.content ?? '';

      if (!content.trim()) {
        throw new Error(`Empty response from ${handle.name}`);
      }

      const elapsedMs = Date.now() - sendStartMs;
      const elapsedSec = (elapsedMs / 1000).toFixed(1);
      this.logger.log(
        `[DONE] ${handle.name} done. (${elapsedSec}s, ${deltaCount} deltas${streaming ? ', streaming' : ''})`,
      );
      return content;
    } finally {
      try {
        await session.destroy();
      } catch (error) {
        this.logger.warn(
          `Failed to destroy session for ${handle.name}: ${sanitizeErrorMessage(error)}`,
        );
      }
    }
  }

  private async stopWithForce(
    client: CopilotClient,
    name: string,
    timeoutMs = 5_000,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('stop timeout')), timeoutMs);
    });
    const stopPromise = client
      .stop()
      .catch((e: unknown) =>
        e instanceof Error ? e : new Error(String(e)),
      );
    try {
      const result = await Promise.race([stopPromise, timeout]);
      if (result instanceof Error) throw result;
    } catch {
      this.logger.warn(`Graceful stop failed for ${name}, force stopping...`);
      try {
        await client.forceStop();
      } catch (error) {
        this.logger.warn(
          `Force stop failed for ${name}: ${sanitizeErrorMessage(error)}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async stopClient(handle: AcpClientHandle): Promise<void> {
    await this.stopWithForce(handle.client, handle.name);
    this.clients.delete(handle);
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopAll();
  }

  async stopAll(): Promise<void> {
    this.stopping = true;
    const handles = [...this.clients];
    this.clients.clear();
    const results = await Promise.allSettled(
      handles.map((handle) => this.stopWithForce(handle.client, handle.name)),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      this.logger.warn(
        `${failed.length} client(s) failed to stop during cleanup`,
      );
    }
  }
}
