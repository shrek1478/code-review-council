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
const C0_CONTROL_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

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

function printDecisionItem(d: ReviewDecisionItem): void {
  const icon = getVerdictIcon(d.verdict);
  console.log(
    `  ${icon} [${sanitizeLine(d.severity)}] ${sanitizeLine(d.category)}: ${sanitizeIndented(d.description, '    ')}`,
  );
  if (d.file) {
    const loc = d.line
      ? `${sanitizeLine(d.file)}:${d.line}`
      : sanitizeLine(d.file);
    console.log(`    File: ${loc}`);
  }
  if (d.reasoning)
    console.log(`    Reasoning: ${sanitizeIndented(d.reasoning, '    ')}`);
  if (d.suggestion)
    console.log(`    Action: ${sanitizeIndented(d.suggestion, '    ')}`);
  if (d.raisedBy?.length > 0) {
    console.log(`    Raised by: ${d.raisedBy.map(sanitizeLine).join(', ')}`);
  }
}

function printDecision(decision: ReviewDecision): void {
  console.log(
    `\n=== Final Decision (by ${sanitizeLine(decision.reviewer)}) ===\n`,
  );
  console.log(sanitize(decision.overallAssessment));
  if (decision.decisions.length > 0) {
    console.log('\nDecisions:');
    for (const d of decision.decisions) {
      printDecisionItem(d);
    }
  }
  if (decision.additionalFindings.length > 0) {
    console.log('\nAdditional Findings (by Decision Maker):');
    for (const f of decision.additionalFindings) {
      console.log(
        `  [${sanitizeLine(f.severity)}] ${sanitizeLine(f.category)}: ${sanitizeIndented(f.description, '    ')}`,
      );
      if (f.file) {
        console.log(`    File: ${sanitizeLine(f.file)}`);
      }
      if (f.suggestion)
        console.log(`    Action: ${sanitizeIndented(f.suggestion, '    ')}`);
    }
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
): string[] {
  const parsed = (
    raw
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  ).filter((c) => {
    if (!validChecks.has(c)) {
      console.warn(
        `Warning: Unknown check category ignored: "${sanitize(c)}"`,
      );
      return false;
    }
    return true;
  });
  if (raw && parsed.length === 0) {
    const valid = [...validChecks].join(', ');
    throw new Error(
      `No valid check categories found. Valid categories: ${valid}`,
    );
  }
  return parsed;
}
