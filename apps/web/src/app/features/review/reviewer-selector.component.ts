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
  custom?: boolean;
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

      @for (agent of agents(); track $index) {
        <div
          class="flex items-center gap-2 p-2 rounded"
          style="border: 1px solid var(--p-surface-border)"
        >
          <p-checkbox
            [binary]="true"
            [(ngModel)]="agent.selected"
            (ngModelChange)="syncConfigToStore()"
            [inputId]="'agent-' + $index"
            [disabled]="!agent.installed"
          />
          <label [for]="'agent-' + $index" class="cursor-pointer flex-1">
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

          @if (agent.custom) {
            <button
              (click)="removeCli($index)"
              title="Remove"
              class="ml-1 opacity-40 hover:opacity-100 transition-opacity"
            >
              <i class="pi pi-times text-xs"></i>
            </button>
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

      @if (showAddForm()) {
        <div class="p-3 rounded space-y-2" style="border: 1px dashed var(--p-primary-color)">
          <div class="flex items-center gap-2">
            <span class="text-xs w-16 shrink-0 text-right" style="color: var(--p-text-muted-color)">Name:</span>
            <input
              type="text"
              [(ngModel)]="newCliName"
              placeholder="(optional)"
              class="flex-1 px-2 py-1 rounded text-sm"
              style="background: var(--p-surface-ground); border: 1px solid var(--p-surface-border); color: var(--p-text-color)"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs w-16 shrink-0 text-right" style="color: var(--p-text-muted-color)">CLI Path:</span>
            <input
              type="text"
              [(ngModel)]="newCliPath"
              placeholder="e.g. copilot"
              class="flex-1 px-2 py-1 rounded text-sm"
              style="background: var(--p-surface-ground); border: 1px solid var(--p-surface-border); color: var(--p-text-color)"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs w-16 shrink-0 text-right" style="color: var(--p-text-muted-color)">Args:</span>
            <input
              type="text"
              [(ngModel)]="newCliArgs"
              placeholder="(space-separated, optional)"
              class="flex-1 px-2 py-1 rounded text-sm"
              style="background: var(--p-surface-ground); border: 1px solid var(--p-surface-border); color: var(--p-text-color)"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs w-16 shrink-0 text-right" style="color: var(--p-text-muted-color)">Protocol:</span>
            <p-select
              [options]="protocolOptions"
              [(ngModel)]="newCliProtocol"
              optionLabel="label"
              optionValue="value"
              styleClass="flex-1"
              appendTo="body"
            />
          </div>
          @if (newCliProtocol === 'copilot') {
            <div class="flex items-center gap-2">
              <span class="text-xs w-16 shrink-0 text-right" style="color: var(--p-text-muted-color)">Model:</span>
              <p-select
                [options]="modelOptions"
                [(ngModel)]="newCliModel"
                optionLabel="label"
                optionValue="value"
                styleClass="flex-1"
                appendTo="body"
              />
            </div>
          }
          <div class="flex justify-end gap-2 pt-1">
            <button
              (click)="showAddForm.set(false)"
              class="px-3 py-1 rounded text-xs opacity-60 hover:opacity-100 transition-opacity"
              style="border: 1px solid var(--p-surface-border); color: var(--p-text-color)"
            >
              Cancel
            </button>
            <button
              (click)="addCli()"
              [disabled]="!newCliPath.trim()"
              class="px-3 py-1 rounded text-xs transition-opacity"
              style="background: var(--p-primary-color); color: var(--p-primary-contrast-color); opacity: 1"
              [style.opacity]="!newCliPath.trim() ? '0.4' : '1'"
              [style.cursor]="!newCliPath.trim() ? 'not-allowed' : 'pointer'"
            >
              Add
            </button>
          </div>
        </div>
      }

      @if (!showAddForm()) {
        <button
          (click)="showAddForm.set(true)"
          class="w-full flex items-center justify-center gap-1 py-2 text-xs opacity-40 hover:opacity-80 transition-opacity rounded"
          style="border: 1px dashed var(--p-surface-border); color: var(--p-text-muted-color)"
        >
          <i class="pi pi-plus"></i> Add CLI
        </button>
      }

    </div>
  `,
})
export class ReviewerSelectorComponent implements OnInit {
  readonly store = inject(ReviewStore);
  private readonly api = inject(ApiService);

  agents = signal<AgentSelection[]>([]);
  detecting = signal(true);

  showAddForm = signal(false);
  newCliName = '';
  newCliPath = '';
  newCliArgs = '';
  newCliProtocol: '' | 'copilot' = '';
  newCliModel = '';

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

  readonly protocolOptions = [
    { label: 'ACP', value: '' },
    { label: 'Copilot', value: 'copilot' },
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

  addCli(): void {
    const cliPath = this.newCliPath.trim();
    if (!cliPath) return;
    let name = this.newCliName.trim() || cliPath;
    // Ensure unique name to prevent progress-tracking conflicts in Live Output
    const existingNames = new Set(this.agents().map(a => a.name));
    if (existingNames.has(name)) {
      let suffix = 2;
      while (existingNames.has(`${name} (${suffix})`)) suffix++;
      name = `${name} (${suffix})`;
    }
    const cliArgs = this.newCliArgs.trim() ? this.newCliArgs.trim().split(/\s+/) : [];
    const protocol = (this.newCliProtocol || undefined) as 'copilot' | undefined;
    this.agents.update(agents => [...agents, {
      name, cliPath, cliArgs,
      installed: true, description: '',
      protocol,
      model: this.newCliModel || undefined,
      selected: true, role: 'reviewer', custom: true,
    }]);
    this.syncConfigToStore();
    this.newCliName = this.newCliPath = this.newCliArgs = this.newCliModel = '';
    this.newCliProtocol = '';
    this.showAddForm.set(false);
  }

  removeCli(index: number): void {
    this.agents.update(agents => agents.filter((_, i) => i !== index));
    this.syncConfigToStore();
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
