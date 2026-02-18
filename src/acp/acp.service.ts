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

  private sanitizeErrorMessage(error: unknown): string {
    const msg = error instanceof Error ? error.message : String(error);
    // Remove potential tokens/secrets from error messages
    return msg.replace(/[A-Za-z0-9+/=_-]{16,}/g, '[REDACTED]');
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

  async createClient(config: ReviewerConfig): Promise<AcpClientHandle> {
    if (this.stopping) {
      throw new Error('Cannot create client: AcpService is shutting down');
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

  private resolveCliPath(cliPath: string): string {
    if (isAbsolute(cliPath)) return cliPath;
    try {
      return execFileSync('which', [cliPath], { encoding: 'utf-8' }).trim();
    } catch {
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
          `Failed to destroy session for ${handle.name}: ${this.sanitizeErrorMessage(error)}`,
        );
      }
    }
  }

  async stopClient(handle: AcpClientHandle): Promise<void> {
    try {
      await handle.client.stop();
    } catch (error) {
      this.logger.warn(
        `Failed to stop client ${handle.name}: ${this.sanitizeErrorMessage(error)}`,
      );
    }
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
      handles.map(async (handle) => {
        try {
          await handle.client.stop();
        } catch (error) {
          this.logger.warn(
            `Failed to stop client ${handle.name}: ${this.sanitizeErrorMessage(error)}`,
          );
        }
      }),
    );
  }
}
