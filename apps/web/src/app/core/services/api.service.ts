import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  ReviewStore,
  CouncilConfig,
  ReviewResult,
  ReviewProgressEvent,
} from './review-store.service';

const API_BASE = '/api';

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface AgentDetectionResult {
  name: string;
  cliPath: string;
  cliArgs: string[];
  protocol?: 'acp' | 'copilot';
  description: string;
  installed: boolean;
  version?: string;
}

interface WsMessage {
  event: string;
  data: unknown;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(ReviewStore);

  async listDirectory(path: string): Promise<DirectoryEntry[]> {
    return firstValueFrom(
      this.http.get<DirectoryEntry[]>(`${API_BASE}/filesystem/list`, {
        params: { path },
      }),
    );
  }

  async detectAgents(): Promise<AgentDetectionResult[]> {
    return firstValueFrom(
      this.http.get<AgentDetectionResult[]>(`${API_BASE}/filesystem/agents`),
    );
  }

  async saveConfig(config: CouncilConfig): Promise<{ success: boolean }> {
    return firstValueFrom(
      this.http.post<{ success: boolean }>(
        `${API_BASE}/filesystem/config/save`,
        config,
      ),
    );
  }

  async getConfig(): Promise<CouncilConfig> {
    return firstValueFrom(
      this.http.get<CouncilConfig>(`${API_BASE}/config`),
    );
  }

  async validateConfig(
    config: unknown,
  ): Promise<{ valid: boolean; error?: string }> {
    return firstValueFrom(
      this.http.post<{ valid: boolean; error?: string }>(
        `${API_BASE}/config/validate`,
        config,
      ),
    );
  }

  startCodebaseReview(params: {
    directory: string;
    extensions?: string[];
    batchSize?: number;
    checks?: string[];
    extra?: string;
    analysisMode?: 'inline' | 'batch' | 'explore';
    config?: CouncilConfig;
  }): void {
    this.store.reset();
    this.store.isReviewing.set(true);
    this.connectWs('start:codebase', params);
  }

  startDiffReview(params: {
    repoPath: string;
    baseBranch?: string;
    checks?: string[];
    extra?: string;
    analysisMode?: 'inline' | 'batch' | 'explore';
    config?: CouncilConfig;
  }): void {
    this.store.reset();
    this.store.isReviewing.set(true);
    this.connectWs('start:diff', params);
  }

  startFileReview(params: {
    filePaths: string[];
    checks?: string[];
    extra?: string;
    analysisMode?: 'inline' | 'batch' | 'explore';
    config?: CouncilConfig;
  }): void {
    this.store.reset();
    this.store.isReviewing.set(true);
    this.connectWs('start:file', params);
  }

  private connectWs(event: string, data: Record<string, unknown>): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws/reviews`);
    let completed = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({ event, data }));
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      switch (msg.event) {
        case 'progress':
          this.store.updateProgress(msg.data as ReviewProgressEvent);
          break;
        case 'delta': {
          const delta = msg.data as { reviewer: string; content: string };
          this.store.appendDelta(delta.reviewer, delta.content);
          break;
        }
        case 'tool-activity': {
          const activity = msg.data as { reviewer: string; toolName: string; args?: unknown };
          this.store.updateToolActivity(activity.reviewer, activity.toolName, activity.args);
          break;
        }
        case 'result':
          completed = true;
          this.store.result.set(msg.data as ReviewResult);
          this.store.isReviewing.set(false);
          ws.close();
          break;
        case 'error':
          completed = true;
          this.store.error.set(
            (msg.data as { message: string }).message,
          );
          this.store.isReviewing.set(false);
          ws.close();
          break;
      }
    };

    ws.onerror = () => {
      if (!completed) {
        this.store.error.set('WebSocket connection error');
        this.store.isReviewing.set(false);
      }
    };

    ws.onclose = () => {
      if (!completed) {
        this.store.error.set('WebSocket connection closed unexpectedly');
        this.store.isReviewing.set(false);
      }
    };
  }
}
