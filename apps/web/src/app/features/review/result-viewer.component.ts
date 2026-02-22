import { Component, inject, computed } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
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
  ReviewDecision,
  AdditionalFinding,
  ReviewDecisionItem,
} from '../../core/services/review-store.service';
import { DecisionTableComponent } from './decision-table.component';

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
  ],
  template: `
    <div class="p-4 space-y-4">

      @if (!store.result() && store.isReviewing() && store.progress().size > 0) {
        <h2 class="text-lg font-bold mb-2">Live Output</h2>
        <p-accordion [multiple]="true">
          @for (name of liveReviewerNames(); track name) {
            <p-accordion-panel [value]="name" [disabled]="isInProgress(name)">
              <p-accordion-header>
                <ng-template #toggleicon let-active="active">
                  @if (isInProgress(name)) {
                    <i class="pi pi-spin pi-spinner" style="font-size:0.875rem"></i>
                  } @else if (active) {
                    <i class="pi pi-chevron-up" style="font-size:0.875rem"></i>
                  } @else {
                    <i class="pi pi-chevron-down" style="font-size:0.875rem"></i>
                  }
                </ng-template>
                <span class="font-medium mr-auto">{{ name }}</span>
                <span class="mr-3">
                  @if (getProgressStatus(name) === 'done') {
                    <p-tag severity="success" value="Done" />
                  } @else if (getProgressStatus(name) === 'error') {
                    <p-tag severity="danger" value="Error" />
                  } @else {
                    <p-tag severity="warn" [value]="getToolActivity(name) || 'Waiting...'" />
                  }
                </span>
              </p-accordion-header>
              <p-accordion-content>
                <div class="relative">
                  @if (getDelta(name)) {
                    <p-button
                      icon="pi pi-copy"
                      severity="secondary"
                      [text]="true"
                      [rounded]="true"
                      size="small"
                      class="absolute top-0 right-0"
                      (onClick)="copyText(getDelta(name))"
                    />
                  }
                  @if (getProgressStatus(name) === 'error') {
                    <div class="text-sm" style="color: var(--p-red-500)">
                      <i class="pi pi-times-circle" style="margin-right: 0.5rem"></i>
                      {{ getProgressError(name) }}
                    </div>
                  } @else if (getDelta(name); as content) {
                    <div class="markdown-body pr-8" [innerHTML]="renderMarkdown(content)"></div>
                  } @else {
                    <div class="text-sm" style="color: var(--p-text-muted-color)">
                      <i class="pi pi-spin pi-spinner" style="margin-right: 0.5rem"></i>
                      Waiting for response...
                    </div>
                  }
                </div>
              </p-accordion-content>
            </p-accordion-panel>
          }
        </p-accordion>

        @if (store.allReviewersDone() && dmName()) {
          <div class="mt-2">
            <h3 class="font-semibold mb-2">
              @if (getProgressStatus(dmName()!) !== 'done') {
                <i class="pi pi-spin pi-spinner" style="margin-right: 0.5rem"></i>
              }
              Decision Maker is reviewing...
            </h3>
            <p-accordion [multiple]="true">
              <p-accordion-panel [value]="dmName()!" [disabled]="isInProgress(dmName()!)">
                <p-accordion-header>
                  <ng-template #toggleicon let-active="active">
                    @if (isInProgress(dmName()!)) {
                      <i class="pi pi-spin pi-spinner" style="font-size:0.875rem"></i>
                    } @else if (active) {
                      <i class="pi pi-chevron-up" style="font-size:0.875rem"></i>
                    } @else {
                      <i class="pi pi-chevron-down" style="font-size:0.875rem"></i>
                    }
                  </ng-template>
                  <span class="font-medium mr-auto">{{ dmName() }}</span>
                  <span class="mr-3">
                    @if (getProgressStatus(dmName()!) === 'done') {
                      <p-tag severity="success" value="Done" />
                    } @else if (getProgressStatus(dmName()!) === 'error') {
                      <p-tag severity="danger" value="Error" />
                    } @else {
                      <p-tag severity="warn" [value]="getToolActivity(dmName()!) || 'Waiting...'" />
                    }
                  </span>
                </p-accordion-header>
                <p-accordion-content>
                  <div class="relative">
                    @if (getDelta(dmName()!)) {
                      <p-button
                        icon="pi pi-copy"
                        severity="secondary"
                        [text]="true"
                        [rounded]="true"
                        size="small"
                        class="absolute top-0 right-0"
                        (onClick)="copyText(getDelta(dmName()!))"
                      />
                    }
                    @if (getProgressStatus(dmName()!) === 'error') {
                      <div class="text-sm" style="color: var(--p-red-500)">
                        <i class="pi pi-times-circle" style="margin-right: 0.5rem"></i>
                        {{ getProgressError(dmName()!) }}
                      </div>
                    } @else if (getDelta(dmName()!); as content) {
                      <div class="markdown-body pr-8" [innerHTML]="renderMarkdown(content)"></div>
                    } @else {
                      <div class="text-sm" style="color: var(--p-text-muted-color)">
                        <i class="pi pi-spin pi-spinner" style="margin-right: 0.5rem"></i>
                        @if (getToolActivity(dmName()!); as activity) {
                          {{ activity }}
                        } @else {
                          Waiting for response...
                        }
                      </div>
                    }
                  </div>
                </p-accordion-content>
              </p-accordion-panel>
            </p-accordion>
          </div>
        }
      }

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
            <span class="text-sm" style="color: var(--p-text-muted-color)">
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
                <div class="relative">
                  <p-button
                    icon="pi pi-copy"
                    severity="secondary"
                    [text]="true"
                    [rounded]="true"
                    size="small"
                    class="absolute top-0 right-0"
                    (onClick)="copyText(review.review)"
                  />
                  <div class="markdown-body pr-8" [innerHTML]="renderMarkdown(review.review)"></div>
                </div>
              </p-accordion-content>
            </p-accordion-panel>
          }
        </p-accordion>

        @if (r.decision) {
          <h2 class="text-lg font-bold mt-4">Final Decision</h2>
          <p-accordion [multiple]="true">
            <p-accordion-panel value="dm">
              <p-accordion-header>
                DM ({{ r.decision.reviewer }})
              </p-accordion-header>
              <p-accordion-content>
                <div class="relative">
                  <p-button
                    icon="pi pi-copy"
                    severity="secondary"
                    [text]="true"
                    [rounded]="true"
                    size="small"
                    class="absolute top-0 right-0"
                    (onClick)="copyDecision(r.decision)"
                  />
                  <p class="text-sm whitespace-pre-wrap mb-3 pr-8">
                    {{ r.decision.overallAssessment }}
                  </p>
                </div>

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
              </p-accordion-content>
            </p-accordion-panel>
          </p-accordion>
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
        <div class="p-4 rounded" style="background: var(--p-red-50); border: 1px solid var(--p-red-200); color: var(--p-red-500)">
          {{ err }}
        </div>
      }
    </div>
  `,
})
export class ResultViewerComponent {
  readonly store = inject(ReviewStore);
  private readonly sanitizer = inject(DomSanitizer);

  readonly dmName = computed(() => this.store.config()?.decisionMaker?.name ?? null);

  readonly liveReviewerNames = computed(() => {
    const dm = this.dmName();
    return [...this.store.progress().keys()].filter((n) => n !== dm);
  });

  getDelta(reviewer: string): string {
    return this.store.reviewerDeltas().get(reviewer) ?? '';
  }

  getProgressStatus(reviewer: string): string {
    return this.store.progress().get(reviewer)?.status ?? 'sending';
  }

  getProgressError(reviewer: string): string {
    return this.store.progress().get(reviewer)?.error ?? 'Review failed';
  }

  getToolActivity(reviewer: string): string {
    return this.store.reviewerToolActivity().get(reviewer) ?? '';
  }

  isInProgress(name: string): boolean {
    const s = this.getProgressStatus(name);
    return s !== 'done' && s !== 'error';
  }

  renderMarkdown(text: string): SafeHtml {
    const html = marked.parse(text, { async: false }) as string;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  copyText(text: string): void {
    navigator.clipboard.writeText(text);
  }

  copyDecision(decision: ReviewDecision): void {
    let text = `## Overall Assessment\n\n${decision.overallAssessment}\n`;
    if (decision.decisions.length > 0) {
      text += `\n## Decisions\n\n`;
      text += `| | Severity | Category | Description | File | Reasoning | Action | Raised by |\n`;
      text += `|---|---|---|---|---|---|---|---|\n`;
      for (const d of decision.decisions) {
        const icon = d.verdict === 'accepted' ? '\u2705' : d.verdict === 'rejected' ? '\u274C' : '\u270F\uFE0F';
        const file = d.file ? `${d.file}${d.line ? ':' + d.line : ''}` : '';
        text += `| ${icon} | ${d.severity} | ${d.category} | ${d.description} | ${file} | ${d.reasoning} | ${d.suggestion} | ${d.raisedBy?.join(', ')} |\n`;
      }
    }
    if (decision.additionalFindings.length > 0) {
      text += `\n## Additional Findings\n\n`;
      text += `| Severity | Category | Description | File | Suggestion |\n`;
      text += `|---|---|---|---|---|\n`;
      for (const f of decision.additionalFindings) {
        text += `| ${f.severity} | ${f.category} | ${f.description} | ${f.file ?? ''} | ${f.suggestion} |\n`;
      }
    }
    navigator.clipboard.writeText(text);
  }

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
