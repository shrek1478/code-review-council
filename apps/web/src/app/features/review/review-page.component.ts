import { Component } from '@angular/core';
import { ReviewFormComponent } from './review-form.component';
import { ResultViewerComponent } from './result-viewer.component';
import { ConfigEditorComponent } from '../config/config-editor.component';

@Component({
  selector: 'app-review-page',
  standalone: true,
  imports: [ReviewFormComponent, ResultViewerComponent, ConfigEditorComponent],
  template: `
    <div class="h-screen flex flex-col">
      <header
        class="bg-gray-900 text-white px-6 py-3 flex items-center gap-3"
      >
        <h1 class="text-xl font-bold">Code Review Council</h1>
      </header>

      <div class="flex flex-1 overflow-hidden">
        <!-- Left Panel -->
        <aside class="w-96 border-r overflow-y-auto bg-gray-50">
          <app-review-form />
          <div class="border-t p-4">
            <app-config-editor />
          </div>
        </aside>

        <!-- Right Panel -->
        <main class="flex-1 overflow-y-auto">
          <app-result-viewer />
        </main>
      </div>
    </div>
  `,
})
export class ReviewPageComponent {}
