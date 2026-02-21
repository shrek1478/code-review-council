import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Textarea } from 'primeng/textarea';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { ReviewStore } from '../../core/services/review-store.service';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'app-config-editor',
  standalone: true,
  imports: [FormsModule, Textarea, Button, Tag],
  template: `
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-gray-600 uppercase">Config</h3>
        <p-button
          label="Load Server Config"
          icon="pi pi-cloud-download"
          size="small"
          severity="secondary"
          (onClick)="loadConfig()"
        />
      </div>

      <textarea
        pTextarea
        [(ngModel)]="configJson"
        [rows]="12"
        class="w-full font-mono text-xs"
        placeholder="Paste or edit JSON config..."
      ></textarea>

      <div class="flex items-center gap-2">
        <p-button
          label="Apply"
          icon="pi pi-check"
          size="small"
          (onClick)="applyConfig()"
        />
        @if (validationStatus() === 'valid') {
          <p-tag severity="success" value="Valid" />
        }
        @if (validationStatus() === 'invalid') {
          <p-tag severity="danger" [value]="validationError()" />
        }
      </div>
    </div>
  `,
})
export class ConfigEditorComponent implements OnInit {
  private readonly store = inject(ReviewStore);
  private readonly api = inject(ApiService);

  configJson = '';
  validationStatus = signal<'none' | 'valid' | 'invalid'>('none');
  validationError = signal('');

  async ngOnInit(): Promise<void> {
    await this.loadConfig();
  }

  async loadConfig(): Promise<void> {
    try {
      const config = await this.api.getConfig();
      this.configJson = JSON.stringify(config, null, 2);
      this.validationStatus.set('valid');
    } catch {
      this.validationStatus.set('invalid');
      this.validationError.set('Failed to load server config');
    }
  }

  async applyConfig(): Promise<void> {
    try {
      const parsed = JSON.parse(this.configJson);
      const result = await this.api.validateConfig(parsed);
      if (result.valid) {
        this.store.config.set(parsed);
        this.validationStatus.set('valid');
      } else {
        this.validationStatus.set('invalid');
        this.validationError.set(result.error ?? 'Invalid config');
      }
    } catch (e) {
      this.validationStatus.set('invalid');
      this.validationError.set(
        e instanceof SyntaxError ? 'Invalid JSON' : 'Validation failed',
      );
    }
  }
}
