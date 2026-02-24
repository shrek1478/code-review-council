import {
  WebSocketGateway,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Inject, ConsoleLogger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { ReviewService } from '../../../../src/review/review.service.js';
import { ConfigService } from '../../../../src/config/config.service.js';
import type { CouncilConfig } from '../../../../src/config/config.types.js';

interface WsIncoming {
  event: string;
  data: Record<string, unknown>;
}

const MAX_CONCURRENT_REVIEWS = 1;

@WebSocketGateway({ path: '/ws/reviews' })
export class ReviewGateway implements OnGatewayConnection {
  private activeReviews = 0;

  constructor(
    private readonly reviewService: ReviewService,
    private readonly configService: ConfigService,
    @Inject(ConsoleLogger) private readonly logger: ConsoleLogger,
  ) {
    this.logger.setContext(ReviewGateway.name);
  }

  handleConnection(client: WebSocket): void {
    client.on('message', (raw: Buffer | string) => {
      let msg: WsIncoming;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        this.send(client, 'error', { message: 'Invalid JSON' });
        return;
      }
      // 基本結構驗證：event 必須是非空字串，data 必須是非 null 物件
      if (
        typeof msg.event !== 'string' ||
        !msg.event ||
        typeof msg.data !== 'object' ||
        msg.data === null ||
        Array.isArray(msg.data)
      ) {
        this.send(client, 'error', { message: 'Invalid message format' });
        return;
      }
      this.handleMessage(client, msg).catch((error) => {
        this.logger.error(
          `Unhandled error in handleMessage: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.send(client, 'error', {
          message: error instanceof Error ? error.message : 'Internal error',
        });
      });
    });
  }

  private async handleMessage(
    client: WebSocket,
    msg: WsIncoming,
  ): Promise<void> {
    const { event, data } = msg;

    const isReviewEvent =
      event === 'start:codebase' ||
      event === 'start:diff' ||
      event === 'start:file';

    if (isReviewEvent && this.activeReviews >= MAX_CONCURRENT_REVIEWS) {
      this.send(client, 'error', {
        message: `A review is already in progress. Please wait for it to complete.`,
      });
      return;
    }

    if (isReviewEvent) {
      this.activeReviews++;
    }
    try {
      switch (event) {
        case 'start:codebase':
          await this.runCodebaseReview(client, data);
          break;
        case 'start:diff':
          await this.runDiffReview(client, data);
          break;
        case 'start:file':
          await this.runFileReview(client, data);
          break;
        default:
          this.send(client, 'error', { message: `Unknown event: ${event}` });
      }
    } finally {
      if (isReviewEvent) {
        this.activeReviews--;
      }
    }
  }

  private createCallbacks(client: WebSocket) {
    const onDelta = (reviewer: string, content: string) => {
      this.send(client, 'delta', { reviewer, content });
    };
    const onReviewerDone = (reviewer: string, status: 'done' | 'error', durationMs: number, error?: string) => {
      this.send(client, 'progress', {
        reviewer,
        status,
        durationMs,
        error,
        timestamp: new Date().toISOString(),
      });
    };
    const onToolActivity = (reviewer: string, toolName: string, args?: unknown) => {
      this.send(client, 'tool-activity', { reviewer, toolName, args });
    };
    let dmName = 'Decision Maker';
    const onDmStart = (name: string) => {
      dmName = name;
      this.send(client, 'progress', { reviewer: name, status: 'sending', timestamp: new Date().toISOString() });
    };
    const onDmDelta = (content: string) => {
      this.send(client, 'delta', { reviewer: dmName, content });
    };
    return { onDelta, onReviewerDone, onToolActivity, onDmStart, onDmDelta };
  }

  private sendInitialProgress(client: WebSocket, config: CouncilConfig): void {
    for (const r of config.reviewers) {
      this.send(client, 'progress', {
        reviewer: r.name,
        status: 'sending',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private resolveMode(data: Record<string, unknown>): 'inline' | 'batch' | 'explore' | undefined {
    const mode = data.analysisMode;
    if (mode === 'inline' || mode === 'batch' || mode === 'explore') return mode;
    return undefined;
  }

  private extractConfig(data: Record<string, unknown>): CouncilConfig | undefined {
    if (data.config && typeof data.config === 'object' && !Array.isArray(data.config)) {
      const partial = data.config as Partial<CouncilConfig>;
      let merged: CouncilConfig;
      if (!partial.decisionMaker) {
        const serverCfg = this.configService.getConfig();
        merged = { ...serverCfg, ...partial, decisionMaker: serverCfg.decisionMaker };
      } else {
        merged = data.config as CouncilConfig;
      }
      const validation = this.configService.validateConfigData(
        merged as unknown as Record<string, unknown>,
      );
      if (!validation.valid) {
        throw new Error(`Invalid config override: ${validation.error}`);
      }
      return merged;
    }
    return undefined;
  }

  private validateString(data: Record<string, unknown>, field: string, required: boolean): string | undefined {
    const value = data[field];
    if (value === undefined || value === null) {
      if (required) throw new Error(`Missing required field: "${field}"`);
      return undefined;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Field "${field}" must be a non-empty string`);
    }
    return value;
  }

  private validateStringArray(data: Record<string, unknown>, field: string): string[] | undefined {
    const value = data[field];
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      throw new Error(`Field "${field}" must be an array of strings`);
    }
    return value;
  }

  private async runDiffReview(
    client: WebSocket,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      const repoPath = this.validateString(data, 'repoPath', true)!;
      const baseBranch = this.validateString(data, 'baseBranch', false) ?? 'main';
      const checks = this.validateStringArray(data, 'checks');
      const extra = this.validateString(data, 'extra', false);
      const configOverride = this.extractConfig(data);
      const config = configOverride ?? this.configService.getConfig();
      this.sendInitialProgress(client, config);
      const { onDelta, onReviewerDone, onToolActivity, onDmStart, onDmDelta } = this.createCallbacks(client);
      const result = await this.reviewService.reviewDiff(
        repoPath,
        baseBranch,
        checks ?? config.review.defaultChecks,
        extra,
        onDelta,
        onReviewerDone,
        onToolActivity,
        this.resolveMode(data),
        configOverride,
        onDmDelta,
        onDmStart,
      );
      this.send(client, 'result', result);
    } catch (error) {
      this.send(client, 'error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async runFileReview(
    client: WebSocket,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      const filePaths = this.validateStringArray(data, 'filePaths');
      if (!filePaths || filePaths.length === 0) {
        throw new Error('Field "filePaths" must be a non-empty array of strings');
      }
      const checks = this.validateStringArray(data, 'checks');
      const extra = this.validateString(data, 'extra', false);
      const configOverride = this.extractConfig(data);
      const config = configOverride ?? this.configService.getConfig();
      this.sendInitialProgress(client, config);
      const { onDelta, onReviewerDone, onToolActivity, onDmStart, onDmDelta } = this.createCallbacks(client);
      const result = await this.reviewService.reviewFiles(
        filePaths,
        checks ?? config.review.defaultChecks,
        extra,
        onDelta,
        onReviewerDone,
        onToolActivity,
        this.resolveMode(data),
        configOverride,
        onDmDelta,
        onDmStart,
      );
      this.send(client, 'result', result);
    } catch (error) {
      this.send(client, 'error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async runCodebaseReview(
    client: WebSocket,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      const directory = this.validateString(data, 'directory', true)!;
      const extensions = this.validateStringArray(data, 'extensions');
      const checks = this.validateStringArray(data, 'checks');
      const extra = this.validateString(data, 'extra', false);
      const batchSize = data.batchSize !== undefined && data.batchSize !== null
        ? (typeof data.batchSize === 'number' ? data.batchSize : undefined)
        : undefined;
      const configOverride = this.extractConfig(data);
      const config = configOverride ?? this.configService.getConfig();
      this.sendInitialProgress(client, config);
      const { onDelta, onReviewerDone, onToolActivity, onDmStart, onDmDelta } = this.createCallbacks(client);
      const result = await this.reviewService.reviewCodebase(
        directory,
        {
          extensions: extensions?.map((e) =>
            e.startsWith('.') ? e : `.${e}`,
          ),
          maxBatchSize: batchSize,
        },
        checks ?? config.review.defaultChecks,
        extra,
        onDelta,
        onReviewerDone,
        onToolActivity,
        this.resolveMode(data),
        configOverride,
        onDmDelta,
        onDmStart,
      );
      this.send(client, 'result', result);
    } catch (error) {
      this.send(client, 'error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private send(client: WebSocket, event: string, data: unknown): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event, data }));
    }
  }
}
