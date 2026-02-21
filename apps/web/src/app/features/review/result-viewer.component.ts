import { Component, inject } from '@angular/core';
import {
  Accordion,
  AccordionPanel,
  AccordionHeader,
  AccordionContent,
} from 'primeng/accordion';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import {
  ReviewStore,
  ReviewResult,
  AdditionalFinding,
  ReviewDecisionItem,
} from '../../core/services/review-store.service';
import { DecisionTableComponent } from './decision-table.component';
import { ProgressTrackerComponent } from './progress-tracker.component';

@Component({
  selector: 'app-result-viewer',
  standalone: true,
  imports: [
    Accordion,
    AccordionPanel,
    AccordionHeader,
    AccordionContent,
    Button,
    Tag,
    DecisionTableComponent,
    ProgressTrackerComponent,
  ],
  template: `
    <div class="p-4 space-y-4">
      <app-progress-tracker />

      @if (store.result(); as r) {
        <div class="flex items-center gap-2 mb-2">
          <h2 class="text-lg font-bold">Individual Reviews</h2>
          <p-tag
            [severity]="
              r.status === 'completed'
                ? 'success'
                : r.status === 'partial'
                  ? 'warn'
                  : 'danger'
            "
            [value]="r.status"
          />
          @if (r.durationMs) {
            <span class="text-sm text-gray-500">
              {{ (r.durationMs / 1000).toFixed(1) }}s
            </span>
          }
        </div>

        <p-accordion [multiple]="true">
          @for (review of r.individualReviews; track review.reviewer) {
            <p-accordion-panel [value]="review.reviewer">
              <p-accordion-header>
                {{ review.reviewer }}
                @if (review.durationMs) {
                  ({{ (review.durationMs / 1000).toFixed(1) }}s)
                }
              </p-accordion-header>
              <p-accordion-content>
                <pre class="whitespace-pre-wrap text-sm">{{
                  review.review
                }}</pre>
              </p-accordion-content>
            </p-accordion-panel>
          }
        </p-accordion>

        @if (r.decision) {
          <h2 class="text-lg font-bold mt-4">
            Final Decision (by {{ r.decision.reviewer }})
          </h2>
          <p class="text-sm whitespace-pre-wrap">
            {{ r.decision.overallAssessment }}
          </p>

          @if (r.decision.decisions.length > 0) {
            <h3 class="font-semibold mt-3">Decisions</h3>
            <app-decision-table [decisions]="r.decision.decisions" />
          }

          @if (r.decision.additionalFindings.length > 0) {
            <h3 class="font-semibold mt-3">Additional Findings</h3>
            <app-decision-table
              [decisions]="toDecisionItems(r.decision.additionalFindings)"
            />
          }
        }

        <div class="flex gap-2 mt-4">
          <p-button
            label="Download JSON"
            icon="pi pi-download"
            severity="secondary"
            (onClick)="downloadJson(r)"
          />
          <p-button
            label="Download Markdown"
            icon="pi pi-file"
            severity="secondary"
            (onClick)="downloadMarkdown(r)"
          />
        </div>
      }

      @if (store.error(); as err) {
        <div class="p-4 bg-red-50 border border-red-200 rounded text-red-700">
          {{ err }}
        </div>
      }
    </div>
  `,
})
export class ResultViewerComponent {
  readonly store = inject(ReviewStore);

  toDecisionItems(findings: AdditionalFinding[]): ReviewDecisionItem[] {
    return findings.map((f) => ({
      ...f,
      verdict: 'accepted' as const,
      raisedBy: ['Decision Maker'],
      reasoning: '',
    }));
  }

  downloadJson(result: ReviewResult): void {
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: 'application/json',
    });
    this.downloadBlob(blob, `review-${result.id}.json`);
  }

  downloadMarkdown(result: ReviewResult): void {
    const md = this.toMarkdown(result);
    const blob = new Blob([md], { type: 'text/markdown' });
    this.downloadBlob(blob, `review-${result.id}.md`);
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private toMarkdown(result: ReviewResult): string {
    let md = `# Code Review Report\n\n`;
    md += `**Status:** ${result.status}\n`;
    if (result.durationMs)
      md += `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s\n`;
    md += `\n## Individual Reviews\n\n`;
    for (const r of result.individualReviews) {
      md += `### ${r.reviewer}`;
      if (r.durationMs) md += ` (${(r.durationMs / 1000).toFixed(1)}s)`;
      md += `\n\n${r.review}\n\n`;
    }
    if (result.decision) {
      const d = result.decision;
      md += `## Final Decision (by ${d.reviewer})\n\n`;
      md += `${d.overallAssessment}\n\n`;
      if (d.decisions.length > 0) {
        md += `### Decisions\n\n`;
        md += `| | Severity | Category | Description | File | Reasoning | Action | Raised by |\n`;
        md += `|---|---|---|---|---|---|---|---|\n`;
        for (const item of d.decisions) {
          const icon =
            item.verdict === 'accepted'
              ? '\u2705'
              : item.verdict === 'rejected'
                ? '\u274C'
                : '\u270F\uFE0F';
          const file = item.file
            ? `${item.file}${item.line ? ':' + item.line : ''}`
            : '';
          md += `| ${icon} | ${item.severity} | ${item.category} | ${item.description} | ${file} | ${item.reasoning} | ${item.suggestion} | ${item.raisedBy?.join(', ')} |\n`;
        }
        md += `\n`;
      }
      if (d.additionalFindings.length > 0) {
        md += `### Additional Findings\n\n`;
        md += `| Severity | Category | Description | File | Suggestion |\n`;
        md += `|---|---|---|---|---|\n`;
        for (const f of d.additionalFindings) {
          const file = f.file ?? '';
          md += `| ${f.severity} | ${f.category} | ${f.description} | ${file} | ${f.suggestion} |\n`;
        }
        md += `\n`;
      }
    }
    return md;
  }
}
