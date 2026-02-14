import { Injectable, Logger } from '@nestjs/common';
import { CopilotClient } from '@github/copilot-sdk';
import { ReviewerConfig } from '../config/config.types.js';

export interface AcpClientHandle {
  name: string;
  client: CopilotClient;
}

@Injectable()
export class AcpService {
  private readonly logger = new Logger(AcpService.name);
  private clients: AcpClientHandle[] = [];

  constructor() {
    // Each ACP client subprocess registers exit/SIGINT/SIGTERM listeners on process.
    // With multiple reviewers + summarizer, this exceeds the default limit of 10.
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
    const handle = { name: config.name, client };
    this.clients.push(handle);
    return handle;
  }

  async sendPrompt(handle: AcpClientHandle, prompt: string): Promise<string> {
    const session = await handle.client.createSession();
    try {
      const result = await new Promise<string>((resolve, reject) => {
        let responseContent = '';
        session.on((event: any) => {
          if (event.type === 'assistant.message') {
            responseContent = event.data.content || '';
          } else if (event.type === 'session.idle') {
            resolve(responseContent);
          } else if (event.type === 'error') {
            reject(new Error(event.data?.message || 'ACP error'));
          }
        });
        session.send({ prompt }).catch(reject);
      });
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
