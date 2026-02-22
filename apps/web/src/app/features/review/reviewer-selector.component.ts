import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Checkbox } from 'primeng/checkbox';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import { ReviewStore } from '../../core/services/review-store.service';
import { ApiService, AgentDetectionResult } from '../../core/services/api.service';

interface AgentSelection extends AgentDetectionResult {
  selected: boolean;
  role: 'reviewer' | 'decisionMaker';
  model?: string;
}

@Component({
  selector: 'app-reviewer-selector',
  standalone: true,
  imports: [FormsModule, Checkbox, Select, Tag],
  template: `
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <h3
          class="text-sm font-semibold uppercase tracking-wide"
          style="color: var(--p-text-muted-color)"
        >
          CLIs
        </h3>
        @if (detecting()) {
          <i class="pi pi-spinner pi-spin text-sm"></i>
        }
      </div>

      @for (agent of agents(); track agent.cliPath) {
        <div
          class="flex items-center gap-2 p-2 rounded"
          style="border: 1px solid var(--p-surface-border)"
        >
          <p-checkbox
            [binary]="true"
            [(ngModel)]="agent.selected"
            (ngModelChange)="syncConfigToStore()"
            [inputId]="agent.cliPath"
            [disabled]="!agent.installed"
          />
          <label [for]="agent.cliPath" class="cursor-pointer flex-1">
            <span class="font-medium">{{ agent.name }}</span>
            <span
              class="text-xs ml-1"
              style="color: var(--p-text-muted-color)"
            >
              ({{ agent.cliPath }})
            </span>
          </label>

          @if (agent.installed) {
            <p-tag severity="success" value="Installed" />
          } @else {
            <p-tag severity="danger" value="Not Found" />
          }
        </div>

        @if (agent.selected && agent.installed) {
          <div class="ml-8 space-y-2 mt-2">
            <div class="flex items-center gap-2">
              <span class="text-xs w-12 shrink-0 text-right" style="color: var(--p-text-muted-color)">Role:</span>
              <p-select
                [options]="roleOptions"
                [(ngModel)]="agent.role"
                (ngModelChange)="syncConfigToStore()"
                optionLabel="label"
                optionValue="value"
                styleClass="flex-1"
                appendTo="body"
              />
            </div>
            @if (agent.protocol === 'copilot') {
              <div class="flex items-center gap-2">
                <span class="text-xs w-12 shrink-0 text-right" style="color: var(--p-text-muted-color)">Model:</span>
                <p-select
                  [options]="modelOptions"
                  [(ngModel)]="agent.model"
                  (ngModelChange)="syncConfigToStore()"
                  optionLabel="label"
                  optionValue="value"
                  styleClass="flex-1"
                  appendTo="body"
                />
              </div>
            }
          </div>
        }
      }

    </div>
  `,
})
export class ReviewerSelectorComponent implements OnInit {
  readonly store = inject(ReviewStore);
  private readonly api = inject(ApiService);

  agents = signal<AgentSelection[]>([]);
  detecting = signal(true);

  readonly roleOptions = [
    { label: 'Reviewer', value: 'reviewer' },
    { label: 'Decision Maker', value: 'decisionMaker' },
  ];

  readonly modelOptions = [
    { label: 'claude-sonnet-4.5', value: 'claude-sonnet-4.5' },
    { label: 'claude-sonnet-4.6', value: 'claude-sonnet-4.6' },
    { label: 'gpt-5-mini', value: 'gpt-5-mini' },
    { label: 'gpt-5.3-codex', value: 'gpt-5.3-codex' },
  ];

  async ngOnInit(): Promise<void> {
    await this.detect();
  }

  async detect(): Promise<void> {
    this.detecting.set(true);
    try {
      const results = await this.api.detectAgents();
      const cfg = this.store.config();

      const agentSelections: AgentSelection[] = results.map((agent) => {
        const isDecisionMaker = cfg?.decisionMaker?.cliPath === agent.cliPath;
        const isReviewer = cfg?.reviewers?.some(
          (r) => r.cliPath === agent.cliPath,
        );
        const existingConfig = isDecisionMaker
          ? cfg?.decisionMaker
          : cfg?.reviewers?.find((r) => r.cliPath === agent.cliPath);

        return {
          ...agent,
          selected: agent.installed && (isReviewer || isDecisionMaker || false),
          role: isDecisionMaker ? 'decisionMaker' as const : 'reviewer' as const,
          model: existingConfig?.model,
        };
      });

      this.agents.set(agentSelections);
      this.syncConfigToStore();
    } catch {
      // detection failed silently
    } finally {
      this.detecting.set(false);
    }
  }

  syncConfigToStore(): void {
    const selected = this.agents().filter((a) => a.selected && a.installed);
    const decisionMakers = selected.filter((a) => a.role === 'decisionMaker');
    const reviewers = selected.filter((a) => a.role === 'reviewer');

    const base = this.store.config();
    const dm = decisionMakers.length === 1 ? decisionMakers[0] : null;

    const config = {
      reviewers: reviewers.map((a) => ({
        name: a.name,
        cliPath: a.cliPath,
        cliArgs: a.cliArgs,
        ...(a.protocol ? { protocol: a.protocol } : {}),
        ...(a.model ? { model: a.model } : {}),
        timeoutMs: 600000,
        maxRetries: 0,
      })),
      ...(dm
        ? {
            decisionMaker: {
              name: dm.name,
              cliPath: dm.cliPath,
              cliArgs: dm.cliArgs,
              ...(dm.protocol ? { protocol: dm.protocol } : {}),
              ...(dm.model ? { model: dm.model } : {}),
              timeoutMs: 600000,
              maxRetries: 0,
            },
          }
        : {}),
      review: base?.review ?? {
        defaultChecks: ['code-quality', 'security', 'performance', 'readability', 'best-practices'],
        language: 'zh-tw',
      },
    };

    this.store.config.set(config);
  }
}
