import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButton } from 'primeng/selectbutton';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { ReviewStore } from '../../core/services/review-store.service';
import { ApiService } from '../../core/services/api.service';
import { ReviewerSelectorComponent } from './reviewer-selector.component';
import { DirectoryPickerComponent } from './directory-picker.component';

@Component({
  selector: 'app-review-form',
  standalone: true,
  imports: [
    FormsModule,
    SelectButton,
    InputText,
    Textarea,
    ReviewerSelectorComponent,
    DirectoryPickerComponent,
  ],
  template: `
    <div class="p-4 space-y-4">
      <div>
        <label class="block text-xs font-semibold uppercase tracking-wide mb-1" style="color: var(--p-text-muted-color)">Mode</label>
        <p-selectbutton
          [options]="modeOptions"
          [(ngModel)]="mode"
          optionLabel="label"
          optionValue="value"
          styleClass="w-full"
        />
      </div>
      <div>
        <label class="block text-xs font-semibold uppercase tracking-wide mb-1" style="color: var(--p-text-muted-color)">Analysis</label>
        <p-selectbutton
          [options]="analysisModeOptions"
          [(ngModel)]="analysisMode"
          optionLabel="label"
          optionValue="value"
          styleClass="w-full"
        />
      </div>

      @switch (mode) {
        @case ('codebase') {
          <div>
            <label class="block text-sm font-medium mb-1" style="color: var(--p-text-muted-color)">Directory</label>
            <div class="flex gap-2">
              <input
                pInputText
                [(ngModel)]="directory"
                class="flex-1"
                placeholder="/path/to/project"
              />
              <app-directory-picker (dirSelected)="directory = $event" />
            </div>
          </div>
        }
        @case ('diff') {
          <div class="flex gap-3 items-end">
            <div class="flex-1">
              <label class="block text-sm font-medium mb-1" style="color: var(--p-text-muted-color)">Repo Path</label>
              <div class="flex gap-2">
                <input
                  pInputText
                  [(ngModel)]="repoPath"
                  class="flex-1"
                  placeholder="."
                />
                <app-directory-picker (dirSelected)="repoPath = $event" />
              </div>
            </div>
            <div style="width: 8rem">
              <label class="block text-sm font-medium mb-1" style="color: var(--p-text-muted-color)">Base Branch</label>
              <input pInputText [(ngModel)]="baseBranch" class="w-full" />
            </div>
          </div>
        }
        @case ('file') {
          <label class="block text-sm font-medium" style="color: var(--p-text-muted-color)"
            >File Paths (one per line)</label
          >
          <textarea
            pTextarea
            [(ngModel)]="filePaths"
            [rows]="4"
            class="w-full"
          ></textarea>
        }
      }

      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--p-text-muted-color)">Extra Instructions</label>
        <textarea
          pTextarea
          [(ngModel)]="extra"
          [rows]="2"
          class="w-full"
          placeholder="Optional: focus on specific areas..."
        ></textarea>
      </div>

      <app-reviewer-selector />
    </div>
  `,
})
export class ReviewFormComponent {
  readonly store = inject(ReviewStore);
  private readonly api = inject(ApiService);

  mode = 'codebase';
  analysisMode = 'batch';
  directory = '';
  repoPath = '.';
  baseBranch = 'main';
  filePaths = '';
  extra = '';

  modeOptions = [
    { label: 'Codebase', value: 'codebase' },
    { label: 'Diff', value: 'diff' },
    { label: 'File', value: 'file' },
  ];

  analysisModeOptions = [
    { label: 'Inline', value: 'inline' },
    { label: 'Batch', value: 'batch' },
    { label: 'Explore', value: 'explore' },
  ];

  async startReview(): Promise<void> {
    switch (this.mode) {
      case 'codebase':
        await this.api.startCodebaseReview({
          directory: this.directory,
          extra: this.extra || undefined,
          analysisMode: this.analysisMode as 'inline' | 'batch' | 'explore',
          config: this.store.config() ?? undefined,
        });
        break;
      case 'diff':
        await this.api.startDiffReview({
          repoPath: this.repoPath,
          baseBranch: this.baseBranch,
          extra: this.extra || undefined,
          analysisMode: this.analysisMode as 'inline' | 'batch' | 'explore',
          config: this.store.config() ?? undefined,
        });
        break;
      case 'file':
        await this.api.startFileReview({
          filePaths: this.filePaths
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean),
          extra: this.extra || undefined,
          analysisMode: this.analysisMode as 'inline' | 'batch' | 'explore',
          config: this.store.config() ?? undefined,
        });
        break;
    }
  }
}
