import { Component, inject, computed } from '@angular/core';
import { Card } from 'primeng/card';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Tag } from 'primeng/tag';
import { ReviewStore } from '../../core/services/review-store.service';

@Component({
  selector: 'app-progress-tracker',
  standalone: true,
  imports: [Card, ProgressSpinner, Tag],
  template: `
    @if (entries().length > 0) {
      <div class="flex flex-wrap gap-3 mb-4">
        @for (entry of entries(); track entry.reviewer) {
          <p-card class="w-40">
            <div class="text-center">
              <div class="font-semibold mb-2">{{ entry.reviewer }}</div>
              @switch (entry.status) {
                @case ('sending') {
                  <p-progressspinner
                    strokeWidth="4"
                    [style]="{ width: '2rem', height: '2rem' }"
                  />
                }
                @case ('done') {
                  <p-tag severity="success" value="Done" />
                  @if (entry.durationMs) {
                    <div class="text-xs text-gray-500 mt-1">
                      {{ (entry.durationMs / 1000).toFixed(1) }}s
                    </div>
                  }
                }
                @case ('error') {
                  <p-tag severity="danger" value="Error" />
                  @if (entry.error) {
                    <div class="text-xs text-red-500 mt-1">{{ entry.error }}</div>
                  }
                }
              }
            </div>
          </p-card>
        }
      </div>
    }
  `,
})
export class ProgressTrackerComponent {
  private readonly store = inject(ReviewStore);
  entries = computed(() => [...this.store.progress().values()]);
}
