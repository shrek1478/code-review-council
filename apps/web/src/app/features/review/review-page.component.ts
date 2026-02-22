import { Component, inject, ViewChild } from '@angular/core';
import { ReviewFormComponent } from './review-form.component';
import { ResultViewerComponent } from './result-viewer.component';
import { ReviewStore } from '../../core/services/review-store.service';
import { Button } from 'primeng/button';

@Component({
  selector: 'app-review-page',
  standalone: true,
  imports: [ReviewFormComponent, ResultViewerComponent, Button],
  template: `
    <div class="h-screen flex flex-col" style="background: var(--p-surface-ground)">
      <header
        class="px-6 py-3 flex items-center gap-3"
        style="background: var(--p-primary-color); color: var(--p-primary-contrast-color)"
      >
        <h1 class="text-xl font-bold">Code Review Council</h1>
      </header>

      <div class="flex flex-1 overflow-hidden">
        <!-- Left Panel -->
        <aside
          class="w-96 flex flex-col overflow-hidden relative"
          style="background: var(--p-surface-card); border-right: 1px solid var(--p-surface-border)"
        >
          <app-review-form class="flex-1 overflow-y-auto" #formRef />
          <div class="p-4" style="border-top: 1px solid var(--p-surface-border)">
            <p-button
              label="Start Review"
              icon="pi pi-play"
              (onClick)="formRef.startReview()"
              [loading]="store.isReviewing()"
              [disabled]="store.isReviewing()"
              styleClass="w-full"
            />
          </div>
          @if (store.isReviewing()) {
            <div
              class="absolute inset-0 z-10"
              style="background: rgba(0,0,0,0.35); cursor: not-allowed"
            ></div>
          }
        </aside>

        <!-- Right Panel -->
        <main class="flex-1 overflow-y-auto" style="background: var(--p-surface-ground)">
          <app-result-viewer />
        </main>
      </div>
    </div>
  `,
})
export class ReviewPageComponent {
  readonly store = inject(ReviewStore);
  @ViewChild('formRef') formRef!: ReviewFormComponent;
}
