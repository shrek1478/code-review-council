import {
  ReviewResult,
  ReviewDecision,
  ReviewDecisionItem,
} from '../review/review.types.js';

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\d<=>A-ORZcf-nqry]/g;

function sanitize(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

export function getVerdictIcon(verdict: ReviewDecisionItem['verdict']): string {
  if (verdict === 'accepted') return '\u2705';
  if (verdict === 'rejected') return '\u274C';
  return '\u270F\uFE0F';
}

function printDecisionItem(d: ReviewDecisionItem): void {
  const icon = getVerdictIcon(d.verdict);
  console.log(`  ${icon} [${d.severity}] ${d.category}: ${sanitize(d.description)}`);
  if (d.reasoning) console.log(`    Reasoning: ${sanitize(d.reasoning)}`);
  if (d.suggestion) console.log(`    Action: ${sanitize(d.suggestion)}`);
  if (d.raisedBy?.length > 0) {
    console.log(`    Raised by: ${d.raisedBy.map(sanitize).join(', ')}`);
  }
}

function printDecision(decision: ReviewDecision): void {
  console.log(`\n=== Final Decision (by ${sanitize(decision.reviewer)}) ===\n`);
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
      console.log(`  [${f.severity}] ${f.category}: ${sanitize(f.description)}`);
      if (f.suggestion) console.log(`    Action: ${sanitize(f.suggestion)}`);
    }
  }
}

export function printResult(result: ReviewResult): void {
  console.log('\n=== Individual Reviews ===\n');
  for (const r of result.individualReviews) {
    console.log(`\n--- ${sanitize(r.reviewer)} ---`);
    console.log(sanitize(r.review));
    console.log();
  }

  if (result.decision) {
    printDecision(result.decision);
  }
}
