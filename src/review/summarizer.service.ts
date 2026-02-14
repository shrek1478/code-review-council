import { Injectable, Logger, Inject } from '@nestjs/common';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { IndividualReview, ReviewSummary } from './review.types.js';

@Injectable()
export class SummarizerService {
  private readonly logger = new Logger(SummarizerService.name);

  constructor(
    @Inject(AcpService) private readonly acpService: AcpService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  async summarize(reviews: IndividualReview[]): Promise<ReviewSummary> {
    const config = this.configService.getConfig();
    const summarizerConfig = config.summarizer;
    const lang = config.review.language ?? 'zh-tw';

    this.logger.log(`Summarizing ${reviews.length} reviews with ${summarizerConfig.name}...`);

    const handle = await this.acpService.createClient(summarizerConfig);

    const reviewsText = reviews
      .map((r) => `=== ${r.reviewer} ===\n${r.review}`)
      .join('\n\n');

    const prompt = `You are a senior engineering lead. Multiple AI code reviewers have reviewed the same code.
Your job is to aggregate their feedback, judge the reasonableness of each suggestion, and produce a final summary.
Reply in ${lang}.

Individual reviews:
${reviewsText}

Please output a JSON object with this structure:
{
  "aggregatedReview": "Overall assessment in 2-3 paragraphs",
  "issues": [
    {
      "severity": "high|medium|low",
      "category": "security|performance|readability|code-quality|best-practices",
      "description": "What the issue is",
      "file": "filename if mentioned",
      "line": null,
      "agreedBy": ["reviewer names who flagged this"],
      "suggestion": "How to fix it"
    }
  ]
}

Only include issues that are reasonable and actionable. Discard suggestions that are subjective or not well-founded.
Output ONLY the JSON object, no markdown fences.`;

    const response = await this.acpService.sendPrompt(handle, prompt);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
      return {
        reviewer: `${summarizerConfig.name} (Summarizer)`,
        aggregatedReview: parsed.aggregatedReview ?? response,
        issues: parsed.issues ?? [],
      };
    } catch {
      this.logger.warn('Failed to parse summarizer response as JSON, returning raw text');
      return {
        reviewer: `${summarizerConfig.name} (Summarizer)`,
        aggregatedReview: response,
        issues: [],
      };
    }
  }
}
