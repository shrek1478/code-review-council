import { Inject, Injectable, ConsoleLogger } from '@nestjs/common';
import { CopilotClient } from '@github/copilot-sdk';
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

export interface AcpClientHandle {
  name: string;
  client: CopilotClient;
  model?: string;
}

@Injectable()
export class AcpService {
  private clients: AcpClientHandle[] = [];

  constructor(@Inject(ConsoleLogger) private readonly logger: ConsoleLogger) {
    this.logger.setContext(AcpService.name);
  }

  async createClient(config: ReviewerConfig): Promise<AcpClientHandle> {
    this.logger.log(`Creating ACP client: ${config.name} (${config.cliPath})`);
    const client = new CopilotClient({
      cliPath: config.cliPath,
      cliArgs: config.cliArgs,
      protocol: 'acp',
    } as ConstructorParameters<typeof CopilotClient>[0]);
    await client.start();
    const handle: AcpClientHandle = { name: config.name, client, model: config.model };
    this.clients.push(handle);
    return handle;
  }

  async sendPrompt(handle: AcpClientHandle, prompt: string, timeoutMs = 180_000): Promise<string> {
    this.logger.log(`📝 ${handle.name} reviewing...`);

    const sessionOpts: AcpSessionOptions = { streaming: true };
    if (handle.model) sessionOpts.model = handle.model;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientAny = handle.client as any;
    if (typeof clientAny.createSession !== 'function') {
      throw new Error(`SDK incompatible: ${handle.name} client has no createSession method`);
    }
    const session: AcpSession = await (
      clientAny as CopilotClientWithSession
    ).createSession(sessionOpts);

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
          if (settled) return;

          if (event.type === 'assistant.message_delta') {
            const delta = event.data?.deltaContent || '';
            if (delta) {
              responseContent += delta;
            }
          } else if (event.type === 'assistant.message') {
            responseContent = event.data?.content || responseContent;
          } else if (event.type === 'session.idle') {
            settled = true;
            clearTimeout(timer);
            resolve(responseContent);
          } else if (event.type === 'session.error' || event.type === 'error') {
            settled = true;
            clearTimeout(timer);
            reject(new Error(event.data?.message || 'ACP error'));
          }
        });

        session.send({ prompt }).catch((err: unknown) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      });

      this.logger.log(`✅ ${handle.name} done.`);
      return result;
    } finally {
      try {
        await session.destroy();
      } catch (error) {
        this.logger.warn(`Failed to destroy session for ${handle.name}: ${error}`);
      }
    }
  }

  async stopClient(handle: AcpClientHandle): Promise<void> {
    try {
      await handle.client.stop();
    } catch (error) {
      this.logger.warn(`Failed to stop client ${handle.name}: ${error}`);
    }
    this.clients = this.clients.filter((h) => h !== handle);
  }

  async stopAll(): Promise<void> {
    const handles = [...this.clients];
    this.clients = [];
    await Promise.allSettled(
      handles.map(async (handle) => {
        try {
          await handle.client.stop();
        } catch (error) {
          this.logger.warn(`Failed to stop client ${handle.name}: ${error}`);
        }
      }),
    );
  }
}
