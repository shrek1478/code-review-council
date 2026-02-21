import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Checkbox } from 'primeng/checkbox';
import { Select } from 'primeng/select';
import { ReviewStore } from '../../core/services/review-store.service';

@Component({
  selector: 'app-reviewer-selector',
  standalone: true,
  imports: [FormsModule, Checkbox, Select],
  template: `
    <div class="space-y-3">
      <h3
        class="text-sm font-semibold text-surface-500 uppercase tracking-wide"
      >
        Reviewers
      </h3>
      @for (reviewer of store.activeReviewers(); track reviewer.name) {
        <div class="flex items-center gap-2">
          <p-checkbox
            [binary]="true"
            [ngModel]="true"
            [inputId]="reviewer.name"
          />
          <label [for]="reviewer.name" class="cursor-pointer">{{
            reviewer.name
          }}</label>
          @if (reviewer.protocol === 'copilot' && reviewer.model) {
            <p-select
              [options]="modelOptions"
              [(ngModel)]="reviewer.model"
              placeholder="Model"
              class="ml-auto"
              [style]="{ width: '12rem' }"
            />
          }
        </div>
      }

      <h3
        class="text-sm font-semibold text-surface-500 uppercase tracking-wide mt-4"
      >
        Decision Maker
      </h3>
      @if (store.config(); as cfg) {
        <div class="flex items-center gap-2">
          <span class="font-medium">{{ cfg.decisionMaker.name }}</span>
          @if (
            cfg.decisionMaker.protocol === 'copilot' &&
            cfg.decisionMaker.model
          ) {
            <p-select
              [options]="modelOptions"
              [(ngModel)]="cfg.decisionMaker.model"
              placeholder="Model"
              class="ml-auto"
              [style]="{ width: '12rem' }"
            />
          }
        </div>
      }
    </div>
  `,
})
export class ReviewerSelectorComponent {
  readonly store = inject(ReviewStore);

  readonly modelOptions = [
    { label: 'claude-sonnet-4.5', value: 'claude-sonnet-4.5' },
    { label: 'claude-sonnet-4.6', value: 'claude-sonnet-4.6' },
    { label: 'gpt-5-mini', value: 'gpt-5-mini' },
    { label: 'gpt-5.3-codex', value: 'gpt-5.3-codex' },
  ];
}
