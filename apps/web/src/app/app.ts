import { Component } from '@angular/core';
import { ReviewPageComponent } from './features/review/review-page.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ReviewPageComponent],
  template: `<app-review-page />`,
})
export class App {}
