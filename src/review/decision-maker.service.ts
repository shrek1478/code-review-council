import { Injectable, ConsoleLogger, Inject } from '@nestjs/common';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { IndividualReview, ReviewDecision } from './review.types.js';

const MAX_CODE_LENGTH = 60_000;
const MAX_REVIEWS_LENGTH = 30_000;

@Injectable()
export class DecisionMakerService {
  constructor(
    @Inject(ConsoleLogger) private readonly logger: ConsoleLogger,
    @Inject(AcpService) private readonly acpService: AcpService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.logger.setContext(DecisionMakerService.name);
  }

  async decide(
    code: string,
    reviews: IndividualReview[],
    isSummaryMode = false,
  ): Promise<ReviewDecision> {
    const config = this.configService.getConfig();
    const dmConfig = config.decisionMaker;
    const lang = config.review.language ?? 'zh-tw';

    this.logger.log(`Decision maker ${dmConfig.name} reviewing code and ${reviews.length} reviewer opinions...`);

    const handle = await this.acpService.createClient(dmConfig);

    const reviewsText = this.buildReviewsSection(reviews);
    const codeSection = isSummaryMode
      ? this.buildSummarySection(code)
      : this.buildCodeSection(code);

    const responsibilities = isSummaryMode
      ? `## Your responsibilities:
1. **Read the file summary** — understand the scope of the codebase being reviewed
2. **Read other reviewers' opinions** — consider their findings carefully
3. **Make final decisions** — agree or disagree with each suggestion based on your judgement
Note: The codebase was too large to include in full. You are given a file summary instead. Focus on evaluating the reviewers' opinions rather than reviewing code directly.`
      : `## Your responsibilities:
1. **Review the code yourself** — form your own independent opinion based on the code provided
2. **Read other reviewers' opinions** — consider their findings
3. **Make final decisions** — agree or disagree with each suggestion based on your own judgement`;

    const prompt = `You are a senior engineering lead and the final decision maker in a code review council.
You MUST reply entirely in ${lang}. All text content must be written in ${lang}.
Respond with ONLY a JSON object. No other text.

${responsibilities}

${codeSection}

## Other reviewers' opinions:
${reviewsText}

## Output format:
Output ONLY a JSON object (no markdown fences, no explanation before or after):
{
  "overallAssessment": "Your own overall assessment of the code quality in 2-3 paragraphs (in ${lang})",
  "decisions": [
    {
      "severity": "high|medium|low",
      "category": "security|performance|readability|code-quality|best-practices",
      "description": "What the issue is (in ${lang})",
      "file": "filename if applicable",
      "line": null,
      "raisedBy": ["reviewer names who flagged this"],
      "verdict": "accepted|rejected|modified",
      "reasoning": "Why you agree, disagree, or modified this suggestion (in ${lang})",
      "suggestion": "Final recommended action (in ${lang})"
    }
  ],
  "additionalFindings": [
    {
      "severity": "high|medium|low",
      "category": "...",
      "description": "Issues YOU found that reviewers missed (in ${lang})",
      "file": "filename if applicable",
      "suggestion": "How to fix it (in ${lang})"
    }
  ]
}

Rules:
- Focus on the TOP 15 most important suggestions only. Skip trivial or low-impact items.
- Be critical: reject suggestions that are subjective, over-engineered, or not actionable
- Add at most 3 additional findings if reviewers missed important issues
- verdict "accepted" = you agree with the reviewer's suggestion
- verdict "rejected" = you disagree and explain why
- verdict "modified" = you partially agree but adjust the recommendation
- Keep reasoning and suggestion fields concise (1-2 sentences each)
- Output ONLY the JSON object, nothing else`;

    this.logger.log(`Sending prompt to decision maker (${prompt.length} chars)`);
    const response = await this.acpService.sendPrompt(handle, prompt, 300_000);

    return this.parseResponse(response, dmConfig.name);
  }

  private parseResponse(response: string, dmName: string): ReviewDecision {
    // Strategy 1: try direct parse
    try {
      const parsed = JSON.parse(response.trim());
      return this.toDecision(parsed, dmName);
    } catch {
      // continue to strategy 2
    }

    // Strategy 2: extract JSON from markdown fences or surrounding text
    const stripped = response
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    try {
      const parsed = JSON.parse(stripped);
      return this.toDecision(parsed, dmName);
    } catch {
      // continue to strategy 3
    }

    // Strategy 3: greedy regex to find JSON object in surrounding text
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.toDecision(parsed, dmName);
      } catch {
        // fall through
      }
    }

    this.logger.warn('Failed to parse decision maker response as JSON, returning raw text');
    return {
      reviewer: `${dmName} (Decision Maker)`,
      overallAssessment: response,
      decisions: [],
      additionalFindings: [],
    };
  }

  private toDecision(parsed: any, dmName: string): ReviewDecision {
    return {
      reviewer: `${dmName} (Decision Maker)`,
      overallAssessment: parsed.overallAssessment ?? '',
      decisions: parsed.decisions ?? [],
      additionalFindings: parsed.additionalFindings ?? [],
    };
  }

  private buildReviewsSection(reviews: IndividualReview[]): string {
    const full = reviews
      .map((r) => `=== ${r.reviewer} ===\n${r.review}`)
      .join('\n\n');

    if (full.length <= MAX_REVIEWS_LENGTH) {
      return full;
    }

    this.logger.log(`Reviews too large (${full.length} chars), truncating each review proportionally`);

    const perReview = Math.floor(MAX_REVIEWS_LENGTH / reviews.length) - 50;
    return reviews
      .map((r) => {
        const text = r.review.length > perReview
          ? r.review.slice(0, perReview) + '\n...(truncated)'
          : r.review;
        return `=== ${r.reviewer} ===\n${text}`;
      })
      .join('\n\n');
  }

  private buildCodeSection(code: string): string {
    if (code.length <= MAX_CODE_LENGTH) {
      return `## Code to review:\n\`\`\`\n${code}\n\`\`\``;
    }

    this.logger.log(`Code too large (${code.length} chars), truncating to ${MAX_CODE_LENGTH}`);
    return `## Code to review (truncated from ${code.length} to ${MAX_CODE_LENGTH} chars):\n\`\`\`\n${code.slice(0, MAX_CODE_LENGTH)}\n...(truncated)\n\`\`\``;
  }

  private buildSummarySection(fileSummary: string): string {
    return `## Files reviewed (file summary — full code was split into batches for individual reviewers):\n\`\`\`\n${fileSummary}\n\`\`\``;
  }
}
