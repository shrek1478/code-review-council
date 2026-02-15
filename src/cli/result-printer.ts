import {
  ReviewResult,
  ReviewDecision,
  ReviewDecisionItem,
} from '../review/review.types.js';

export function getVerdictIcon(verdict: ReviewDecisionItem['verdict']): string {
  if (verdict === 'accepted') return '\u2705';
  if (verdict === 'rejected') return '\u274C';
  return '\u270F\uFE0F';
}

function printDecisionItem(d: ReviewDecisionItem): void {
  const icon = getVerdictIcon(d.verdict);
  console.log(`  ${icon} [${d.severity}] ${d.category}: ${d.description}`);
  if (d.reasoning) console.log(`    Reasoning: ${d.reasoning}`);
  if (d.suggestion) console.log(`    Action: ${d.suggestion}`);
  if (d.raisedBy?.length > 0) {
    console.log(`    Raised by: ${d.raisedBy.join(', ')}`);
  }
}

function printDecision(decision: ReviewDecision): void {
  console.log(`\n=== Final Decision (by ${decision.reviewer}) ===\n`);
  console.log(decision.overallAssessment);
  if (decision.decisions.length > 0) {
    console.log('\nDecisions:');
    for (const d of decision.decisions) {
      printDecisionItem(d);
    }
  }
  if (decision.additionalFindings.length > 0) {
    console.log('\nAdditional Findings (by Decision Maker):');
    for (const f of decision.additionalFindings) {
      console.log(`  [${f.severity}] ${f.category}: ${f.description}`);
      if (f.suggestion) console.log(`    Action: ${f.suggestion}`);
    }
  }
}

export function printResult(result: ReviewResult): void {
  console.log('\n=== Individual Reviews ===\n');
  for (const r of result.individualReviews) {
    console.log(`\n--- ${r.reviewer} ---`);
    console.log(r.review);
    console.log();
  }

  if (result.decision) {
    printDecision(result.decision);
  }
}
