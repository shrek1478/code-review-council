import {
  Inject,
  Injectable,
  ConsoleLogger,
  OnModuleDestroy,
} from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { CopilotClient } from '@shrek1478/copilot-sdk-with-acp';
import { ReviewerConfig } from '../config/config.types.js';
import { sanitizeErrorMessage } from '../review/retry-utils.js';

export interface AcpSessionOptions {
  streaming: boolean;
  model?: string;
}

export interface AcpEvent {
  type: string;
  data?: {
    content?: string;
    deltaContent?: string;
    message?: string;
  };
}

export interface AcpSession {
  on(callback: (event: AcpEvent) => void): void;
  send(params: { prompt: string }): Promise<void>;
  destroy(): Promise<void>;
}

interface CopilotClientWithSession {
  createSession(opts: AcpSessionOptions): Promise<AcpSession>;
}

interface AcpUsageEvent extends AcpEvent {
  data?: AcpEvent['data'] & {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
  };
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

function isUsageEvent(event: AcpEvent): event is AcpUsageEvent {
  return event.type === 'assistant.usage';
}

export interface AcpClientHandle {
  name: string;
  client: CopilotClient;
  model?: string;
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
          return `${arg.slice(0, eqIdx + 1)}[REDACTED]`;
        }
      }
      return arg;
    });
  }

  private looksLikeSecret(value: string): boolean {
    if (value.length < 8) return false;
    // Common secret prefixes
    if (/^(sk-|ghp_|gho_|ghu_|ghs_|ghr_|glpat-|xox[bsrap]-)/i.test(value))
      return true;
    // Base64-like long strings (32+ chars, alphanumeric with +/= padding)
    if (value.length >= 32 && /^[A-Za-z0-9+/=_-]+$/.test(value)) return true;
    return false;
  }

  private static readonly SAFE_CLI_NAME = /^(?!-)[A-Za-z0-9._-]+$/;

  async createClient(config: ReviewerConfig): Promise<AcpClientHandle> {
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
    const cliPath = this.resolveCliPath(config.cliPath);
    const modelInfo = config.model ? ` [model: ${config.model}]` : '';
    const maskedArgs = this.maskSensitiveArgs(config.cliArgs);
    const argsInfo = maskedArgs.length > 0 ? ` ${maskedArgs.join(' ')}` : '';
    this.logger.log(
      `Creating ACP client: ${config.name} (${cliPath}${argsInfo})${modelInfo}`,
    );
    const client = new CopilotClient({
      cliPath,
      cliArgs: config.cliArgs,
      protocol: config.protocol ?? 'acp',
    } as ConstructorParameters<typeof CopilotClient>[0]);
    await client.start();
    const handle: AcpClientHandle = {
      name: config.name,
      client,
      model: config.model,
    };
    this.clients.add(handle);
    return handle;
  }

  /**
   * Resolve a CLI command name to its absolute path (cached).
   * - Absolute paths are returned as-is (used internally by SDK; config validator restricts
   *   user-facing cliPath to bare command names for security).
   * - Bare command names are resolved via `which` (Unix/macOS) or `where` (Windows);
   *   falls back to original on failure.
   * - On Windows, `where` may return multiple matches; the first line is used.
   */
  private resolveCliPath(cliPath: string): string {
    if (isAbsolute(cliPath)) return cliPath;
    const cached = this.resolvedPaths.get(cliPath);
    if (cached) return cached;
    const lookupCmd = process.platform === 'win32' ? 'where' : 'which';
    try {
      const output = execFileSync(lookupCmd, [cliPath], { encoding: 'utf-8' });
      // `where` may return multiple matches (one per line); use the first non-empty line
      const resolved =
        output
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.length > 0) ?? cliPath;
      this.resolvedPaths.set(cliPath, resolved);
      return resolved;
    } catch {
      this.logger.debug(
        `Could not resolve "${cliPath}" via ${lookupCmd}, using as-is`,
      );
      this.resolvedPaths.set(cliPath, cliPath);
      return cliPath;
    }
  }

  private asSessionClient(
    client: CopilotClient,
    name: string,
  ): CopilotClientWithSession {
    const c = client as unknown as CopilotClientWithSession;
    if (typeof c.createSession !== 'function') {
      throw new Error(
        `SDK incompatible: ${name} client has no createSession method`,
      );
    }
    return c;
  }

  async sendPrompt(
    handle: AcpClientHandle,
    prompt: string,
    timeoutMs = 180_000,
  ): Promise<string> {
    this.logger.log(`[SEND] ${handle.name} reviewing...`);

    const sessionOpts: AcpSessionOptions = { streaming: true };
    if (handle.model) sessionOpts.model = handle.model;
    const sessionClient = this.asSessionClient(handle.client, handle.name);
    const session: AcpSession = await sessionClient.createSession(sessionOpts);

    try {
      const result = await new Promise<string>((resolve, reject) => {
        let responseContent = '';
        let settled = false;

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error(`${handle.name} timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);

        session.on((event: AcpEvent) => {
          // Log model info from usage events (may arrive after session.idle)
          if (isUsageEvent(event)) {
            const model = event.data?.model ?? event.model;
            const input = event.data?.inputTokens ?? event.inputTokens;
            const output = event.data?.outputTokens ?? event.outputTokens;
            if (model) {
              this.logger.log(
                `[MODEL] ${handle.name} model: ${model} (in: ${input ?? '?'}, out: ${output ?? '?'})`,
              );
            }
          }

          if (settled) return;

          if (event.type === 'assistant.message_delta') {
            const delta = event.data?.deltaContent || '';
            if (delta) {
              responseContent += delta;
            }
          } else if (event.type === 'assistant.message') {
            // Only use full message content as fallback when no delta content was accumulated
            if (!responseContent && event.data?.content) {
              responseContent = event.data.content;
            }
          } else if (event.type === 'session.idle') {
            settled = true;
            clearTimeout(timer);
            if (!responseContent.trim()) {
              reject(new Error(`Empty response from ${handle.name}`));
            } else {
              resolve(responseContent);
            }
          } else if (event.type === 'session.error' || event.type === 'error') {
            settled = true;
            clearTimeout(timer);
            reject(new Error(event.data?.message || 'ACP error'));
          }
        });

        session.send({ prompt }).catch((err: unknown) => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      });

      this.logger.log(`[DONE] ${handle.name} done.`);
      return result;
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
    const stopPromise = client.stop();
    try {
      await Promise.race([stopPromise, timeout]);
    } catch {
      // Prevent unhandled rejection from the dangling stopPromise
      stopPromise.catch(() => {});
      this.logger.warn(
        `Graceful stop failed for ${name}, force stopping...`,
      );
      const fc = client as unknown as { forceStop?(): Promise<void> };
      if (typeof fc.forceStop !== 'function') return;
      try {
        await fc.forceStop();
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
    await Promise.allSettled(
      handles.map((handle) =>
        this.stopWithForce(handle.client, handle.name),
      ),
    );
  }
}
