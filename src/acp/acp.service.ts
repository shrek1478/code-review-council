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
    const session: AcpSession = await (handle.client as any).createSession(sessionOpts);

    try {
      const result = await new Promise<string>((resolve, reject) => {
        let responseContent = '';
        let settled = false;

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error(`${handle.name} timed out after ${(timeoutMs / 1000).toFixed(0)}s`));
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

        session.send({ prompt }).catch((err: Error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
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

  async stopAll(): Promise<void> {
    for (const handle of this.clients) {
      try {
        await handle.client.stop();
      } catch (error) {
        this.logger.warn(`Failed to stop client ${handle.name}: ${error}`);
      }
    }
    this.clients = [];
  }
}
