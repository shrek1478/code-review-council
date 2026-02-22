import { Component, inject, signal, output } from '@angular/core';
import { Dialog } from 'primeng/dialog';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { FormsModule } from '@angular/forms';
import { ApiService, DirectoryEntry } from '../../core/services/api.service';

@Component({
  selector: 'app-directory-picker',
  standalone: true,
  imports: [Dialog, Button, InputText, FormsModule],
  template: `
    <p-button
      icon="pi pi-folder-open"
      severity="secondary"
      [outlined]="true"
      (onClick)="open()"
      pTooltip="Browse"
    />

    <p-dialog
      header="Select Directory"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '500px', height: '600px' }"
      [contentStyle]="{ overflow: 'auto' }"
    >
      <div class="flex items-center gap-2 mb-3">
        <input
          pInputText
          [(ngModel)]="currentPath"
          class="flex-1"
          placeholder="/"
          (keydown.enter)="navigateTo(currentPath)"
        />
        <p-button
          icon="pi pi-arrow-right"
          severity="secondary"
          (onClick)="navigateTo(currentPath)"
        />
      </div>

      @if (loading()) {
        <div class="flex justify-center p-4">
          <i class="pi pi-spinner pi-spin text-2xl"></i>
        </div>
      } @else if (error()) {
        <div
          class="p-3 rounded text-sm"
          style="background: var(--p-red-50); color: var(--p-red-500)"
        >
          {{ error() }}
        </div>
      } @else {
        @if (currentPath !== '/') {
          <div
            class="flex items-center gap-2 p-2 cursor-pointer rounded"
            style="border-bottom: 1px solid var(--p-surface-border)"
            (click)="goUp()"
          >
            <i class="pi pi-arrow-up" style="color: var(--p-text-muted-color)"></i>
            <span style="color: var(--p-text-muted-color)">..</span>
          </div>
        }
        @for (entry of entries(); track entry.path) {
          <div
            class="flex items-center gap-2 p-2 cursor-pointer rounded"
            [style.background]="selectedPath() === entry.path ? 'var(--p-primary-color)' : ''"
            [style.color]="selectedPath() === entry.path ? 'var(--p-primary-contrast-color)' : ''"
            (click)="selectEntry(entry)"
            (dblclick)="navigateTo(entry.path)"
          >
            <i class="pi pi-folder"></i>
            <span>{{ entry.name }}</span>
          </div>
        }
        @if (entries().length === 0) {
          <div class="p-4 text-center" style="color: var(--p-text-muted-color)">
            No subdirectories
          </div>
        }
      }

      <ng-template #footer>
        <div class="flex items-center gap-2">
          <span
            class="flex-1 text-sm truncate"
            style="color: var(--p-text-muted-color)"
          >
            {{ selectedPath() || currentPath }}
          </span>
          <p-button
            label="Cancel"
            severity="secondary"
            (onClick)="visible = false"
          />
          <p-button label="Select" (onClick)="confirm()" />
        </div>
      </ng-template>
    </p-dialog>
  `,
})
export class DirectoryPickerComponent {
  private readonly api = inject(ApiService);

  readonly dirSelected = output<string>();

  visible = false;
  currentPath = '';
  entries = signal<DirectoryEntry[]>([]);
  selectedPath = signal<string>('');
  loading = signal(false);
  error = signal('');

  async open(): Promise<void> {
    this.visible = true;
    await this.navigateTo(this.currentPath);
  }

  async navigateTo(path: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.selectedPath.set('');
    try {
      const entries = await this.api.listDirectory(path);
      this.entries.set(entries);
      // Infer current path from first entry's parent
      if (!path && entries.length > 0) {
        const firstPath = entries[0].path;
        this.currentPath = firstPath.substring(
          0,
          firstPath.lastIndexOf('/'),
        );
      } else {
        this.currentPath = path;
      }
    } catch {
      this.error.set(`Cannot read directory: ${path}`);
      this.currentPath = path || '/';
      this.entries.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  selectEntry(entry: DirectoryEntry): void {
    this.selectedPath.set(entry.path);
  }

  async goUp(): Promise<void> {
    const parent = this.currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    await this.navigateTo(parent);
  }

  confirm(): void {
    const path = this.selectedPath() || this.currentPath;
    this.dirSelected.emit(path);
    this.visible = false;
  }
}
