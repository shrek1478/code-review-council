import { Injectable, Logger } from '@nestjs/common';
import { CopilotClient } from '@github/copilot-sdk';
import { ReviewerConfig } from '../config/config.types.js';

export interface AcpClientHandle {
  name: string;
  client: CopilotClient;
  model?: string;
}

@Injectable()
export class AcpService {
  private readonly logger = new Logger(AcpService.name);
  private clients: AcpClientHandle[] = [];

  constructor() {
    // Each ACP client subprocess registers exit/SIGINT/SIGTERM listeners on process.
    // With multiple reviewers + decision maker, this exceeds the default limit of 10.
    process.setMaxListeners(process.getMaxListeners() + 20);
  }

  async createClient(config: ReviewerConfig): Promise<AcpClientHandle> {
    this.logger.log(`Creating ACP client: ${config.name} (${config.cliPath})`);
    const client = new CopilotClient({
      cliPath: config.cliPath,
      cliArgs: config.cliArgs,
      protocol: 'acp',
    } as any);
    await client.start();
    const handle: AcpClientHandle = { name: config.name, client, model: config.model };
    this.clients.push(handle);
    return handle;
  }

  async sendPrompt(handle: AcpClientHandle, prompt: string, timeoutMs = 180_000): Promise<string> {
    this.logger.log(`📝 ${handle.name} reviewing...`);

    const sessionOpts: Record<string, any> = { streaming: true };
    if (handle.model) sessionOpts.model = handle.model;
    const session = await (handle.client as any).createSession(sessionOpts);

    try {
      const result = await new Promise<string>((resolve, reject) => {
        let responseContent = '';
        let settled = false;

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error(`${handle.name} timed out after ${timeoutMs / 1000}s`));
          }
        }, timeoutMs);

        session.on((event: any) => {
          if (settled) return;

          if (event.type === 'assistant.message_delta') {
            const delta = event.data?.deltaContent || '';
            if (delta) {
              process.stdout.write(delta);
            }
          } else if (event.type === 'assistant.message') {
            responseContent = event.data.content || '';
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
      try { await session.destroy(); } catch {}
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
