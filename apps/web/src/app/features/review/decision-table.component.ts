import { Component, input } from '@angular/core';
import { Table } from 'primeng/table';
import { Tag } from 'primeng/tag';
import { ReviewDecisionItem } from '../../core/services/review-store.service';

@Component({
  selector: 'app-decision-table',
  standalone: true,
  imports: [Table, Tag],
  template: `
    <p-table [value]="decisions()" [scrollable]="true" styleClass="p-datatable-sm">
      <ng-template #header>
        <tr>
          <th style="width: 3rem"></th>
          <th>Severity</th>
          <th>Category</th>
          <th>Description</th>
          <th>File</th>
          <th>Reasoning</th>
          <th>Action</th>
          <th>Raised by</th>
        </tr>
      </ng-template>
      <ng-template #body let-d>
        <tr>
          <td>{{ verdictIcon(d.verdict) }}</td>
          <td>
            <p-tag
              [severity]="severityColor(d.severity)"
              [value]="d.severity"
            />
          </td>
          <td>{{ d.category }}</td>
          <td>{{ d.description }}</td>
          <td>
            @if (d.file) {
              <code>{{ d.file }}{{ d.line ? ':' + d.line : '' }}</code>
            }
          </td>
          <td>{{ d.reasoning }}</td>
          <td>{{ d.suggestion }}</td>
          <td>{{ d.raisedBy?.join(', ') }}</td>
        </tr>
      </ng-template>
    </p-table>
  `,
})
export class DecisionTableComponent {
  decisions = input.required<ReviewDecisionItem[]>();

  verdictIcon(verdict: string): string {
    if (verdict === 'accepted') return '\u2705';
    if (verdict === 'rejected') return '\u274C';
    return '\u270F\uFE0F';
  }

  severityColor(severity: string): 'danger' | 'warn' | 'info' {
    if (severity === 'high') return 'danger';
    if (severity === 'medium') return 'warn';
    return 'info';
  }
}
