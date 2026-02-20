import {
  ReviewResult,
  ReviewDecision,
  ReviewDecisionItem,
} from '../review/review.types.js';

// CSI sequences: ESC [ ... final_byte
// eslint-disable-next-line no-control-regex
const CSI_REGEX = /[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[@-~]/g;
// OSC sequences: ESC ] ... (BEL | ESC \)
// eslint-disable-next-line no-control-regex
const OSC_REGEX = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g;
// DCS, PM, APC sequences: ESC (P|^|_) ... ESC \
// eslint-disable-next-line no-control-regex
const DCS_PM_APC_REGEX = /\u001b[P^_][\s\S]*?\u001b\\/g;
// eslint-disable-next-line no-control-regex
const C0_CONTROL_REGEX = /[\x00-\x08\x0B-\x0C\x0E-\x1F\r]/g;

export function sanitize(text: string): string {
  return text
    .replace(OSC_REGEX, '')
    .replace(DCS_PM_APC_REGEX, '')
    .replace(CSI_REGEX, '')
    .replace(C0_CONTROL_REGEX, '');
}

/** Sanitize multiline text and indent continuation lines for aligned CLI output. */
function sanitizeIndented(text: string, indent: string): string {
  const clean = sanitize(text);
  return clean.replace(/\n/g, `\n${indent}`);
}

function sanitizeLine(text: string): string {
  return sanitize(text).replace(/[\r\n]+/g, ' ');
}

export function getVerdictIcon(verdict: ReviewDecisionItem['verdict']): string {
  if (verdict === 'accepted') return '\u2705';
  if (verdict === 'rejected') return '\u274C';
  return '\u270F\uFE0F';
}

/** Escape pipe characters and collapse newlines for markdown table cells. */
function tableCell(text: string): string {
  return sanitizeLine(text).replace(/\|/g, '\\|');
}

function printDecisionsTable(decisions: ReviewDecisionItem[]): void {
  console.log('\nDecisions:\n');
  console.log(
    '| | Severity | Category | Description | File | Reasoning | Action | Raised by |',
  );
  console.log(
    '|---|---|---|---|---|---|---|---|',
  );
  for (const d of decisions) {
    const icon = getVerdictIcon(d.verdict);
    const file = d.file
      ? d.line
        ? `${tableCell(d.file)}:${d.line}`
        : tableCell(d.file)
      : '';
    const raisedBy =
      d.raisedBy?.length > 0
        ? d.raisedBy.map((r) => tableCell(r)).join(', ')
        : '';
    console.log(
      `| ${icon} | ${tableCell(d.severity)} | ${tableCell(d.category)} | ${tableCell(d.description)} | ${file} | ${tableCell(d.reasoning)} | ${tableCell(d.suggestion)} | ${raisedBy} |`,
    );
  }
}

function printAdditionalFindingsTable(
  findings: ReviewDecision['additionalFindings'],
): void {
  console.log('\nAdditional Findings (by Decision Maker):\n');
  console.log('| Severity | Category | Description | File | Action |');
  console.log('|---|---|---|---|---|');
  for (const f of findings) {
    const file = f.file ? tableCell(f.file) : '';
    console.log(
      `| ${tableCell(f.severity)} | ${tableCell(f.category)} | ${tableCell(f.description)} | ${file} | ${tableCell(f.suggestion)} |`,
    );
  }
}

function printDecision(decision: ReviewDecision): void {
  console.log(
    `\n=== Final Decision (by ${sanitizeLine(decision.reviewer)}) ===\n`,
  );
  console.log(sanitize(decision.overallAssessment));
  if (decision.decisions.length > 0) {
    printDecisionsTable(decision.decisions);
  }
  if (decision.additionalFindings.length > 0) {
    printAdditionalFindingsTable(decision.additionalFindings);
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

export function printResult(result: ReviewResult): void {
  console.log('\n=== Individual Reviews ===\n');
  for (const r of result.individualReviews) {
    const timing =
      r.durationMs != null ? ` (${formatDuration(r.durationMs)})` : '';
    console.log(`\n--- ${sanitizeLine(r.reviewer)}${timing} ---`);
    console.log(sanitize(r.review));
    console.log();
  }

  if (result.decision) {
    printDecision(result.decision);
  }

  if (result.durationMs != null) {
    console.log(
      `\n--- Total review time: ${formatDuration(result.durationMs)} (${result.durationMs}ms) ---`,
    );
  }
}

export function parseChecksOption(
  raw: string | undefined,
  validChecks: Set<string>,
  defaultChecks: string[],
): string[] {
  if (!raw) return defaultChecks;
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((c) => {
      if (!validChecks.has(c)) {
        console.warn(
          `Warning: Unknown check category ignored: "${sanitize(c)}"`,
        );
        return false;
      }
      return true;
    });
  if (parsed.length === 0) {
    const valid = [...validChecks].join(', ');
    throw new Error(
      `No valid check categories found. Valid categories: ${valid}`,
    );
  }
  return parsed;
}
