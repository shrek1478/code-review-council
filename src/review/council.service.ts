import { Inject, Injectable, Logger } from '@nestjs/common';
import { AcpService } from '../acp/acp.service.js';
import { ConfigService } from '../config/config.service.js';
import { IndividualReview, ReviewRequest } from './review.types.js';

@Injectable()
export class CouncilService {
  private readonly logger = new Logger(CouncilService.name);

  constructor(
    @Inject(AcpService) private readonly acpService: AcpService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  async dispatchReviews(request: ReviewRequest): Promise<IndividualReview[]> {
    const config = this.configService.getConfig();
    const reviewers = config.reviewers;

    this.logger.log(`Dispatching reviews to ${reviewers.length} reviewers...`);

    const prompt = this.buildReviewPrompt(request);

    const reviewPromises = reviewers.map(async (reviewerConfig) => {
      try {
        const handle = await this.acpService.createClient(reviewerConfig);
        const review = await this.acpService.sendPrompt(handle, prompt);
        return { reviewer: reviewerConfig.name, review };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Reviewer ${reviewerConfig.name} failed: ${msg}`);
        return { reviewer: reviewerConfig.name, review: `[error] ${msg}` };
      }
    });

    return Promise.all(reviewPromises);
  }

  private buildReviewPrompt(request: ReviewRequest): string {
    const config = this.configService.getConfig();
    const lang = request.language ?? config.review.language ?? 'zh-tw';
    const checks = request.checks.length > 0 ? request.checks : config.review.defaultChecks;

    let prompt = `You are a senior code reviewer. Please review the following code.
You MUST reply entirely in ${lang}. All descriptions, suggestions, and explanations must be written in ${lang}.

Check for: ${checks.join(', ')}

For each issue found, provide:
- Severity (high/medium/low)
- Category
- Description (in ${lang})
- File and line number if applicable
- Suggested fix (in ${lang})

Code to review:
\`\`\`
${request.code}
\`\`\``;

    if (request.extraInstructions) {
      prompt += `\n\nAdditional instructions: ${request.extraInstructions}`;
    }

    return prompt;
  }
}
