import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButton } from 'primeng/selectbutton';
import { InputText } from 'primeng/inputtext';
import { Button } from 'primeng/button';
import { Textarea } from 'primeng/textarea';
import { ReviewStore } from '../../core/services/review-store.service';
import { ApiService } from '../../core/services/api.service';
import { ReviewerSelectorComponent } from './reviewer-selector.component';

@Component({
  selector: 'app-review-form',
  standalone: true,
  imports: [
    FormsModule,
    SelectButton,
    InputText,
    Button,
    Textarea,
    ReviewerSelectorComponent,
  ],
  template: `
    <div class="space-y-4 p-4">
      <h2 class="text-lg font-bold">Review Mode</h2>
      <p-selectbutton
        [options]="modeOptions"
        [(ngModel)]="mode"
        optionLabel="label"
        optionValue="value"
      />

      @switch (mode) {
        @case ('codebase') {
          <label class="block text-sm font-medium">Directory</label>
          <input
            pInputText
            [(ngModel)]="directory"
            class="w-full"
            placeholder="/path/to/project"
          />
          <label class="block text-sm font-medium">Extensions</label>
          <input
            pInputText
            [(ngModel)]="extensions"
            placeholder="ts,js"
            class="w-full"
          />
        }
        @case ('diff') {
          <label class="block text-sm font-medium">Repo Path</label>
          <input
            pInputText
            [(ngModel)]="repoPath"
            class="w-full"
            placeholder="."
          />
          <label class="block text-sm font-medium">Base Branch</label>
          <input pInputText [(ngModel)]="baseBranch" class="w-full" />
        }
        @case ('file') {
          <label class="block text-sm font-medium"
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

      <label class="block text-sm font-medium">Extra Instructions</label>
      <textarea
        pTextarea
        [(ngModel)]="extra"
        [rows]="2"
        class="w-full"
        placeholder="Optional: focus on specific areas..."
      ></textarea>

      <app-reviewer-selector />

      <p-button
        label="Start Review"
        icon="pi pi-play"
        (onClick)="startReview()"
        [loading]="store.isReviewing()"
        [disabled]="store.isReviewing()"
        styleClass="w-full"
      />
    </div>
  `,
})
export class ReviewFormComponent {
  readonly store = inject(ReviewStore);
  private readonly api = inject(ApiService);

  mode = 'codebase';
  directory = '';
  extensions = 'ts';
  repoPath = '.';
  baseBranch = 'main';
  filePaths = '';
  extra = '';

  modeOptions = [
    { label: 'Codebase', value: 'codebase' },
    { label: 'Diff', value: 'diff' },
    { label: 'File', value: 'file' },
  ];

  async startReview(): Promise<void> {
    switch (this.mode) {
      case 'codebase':
        await this.api.startCodebaseReview({
          directory: this.directory,
          extensions: this.extensions
            .split(',')
            .map((e) => e.trim())
            .filter(Boolean),
          extra: this.extra || undefined,
        });
        break;
      case 'diff':
        await this.api.startDiffReview({
          repoPath: this.repoPath,
          baseBranch: this.baseBranch,
          extra: this.extra || undefined,
        });
        break;
      case 'file':
        await this.api.startFileReview({
          filePaths: this.filePaths
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean),
          extra: this.extra || undefined,
        });
        break;
    }
  }
}
