import { Controller, Post, Body, Inject } from '@nestjs/common';
import { ReviewService } from './review.service.js';
import { ReviewResult } from './review.types.js';

interface DiffReviewDto {
  repoPath: string;
  baseBranch?: string;
  checks?: string[];
  extraInstructions?: string;
}

interface FileReviewDto {
  files: string[];
  checks?: string[];
  extraInstructions?: string;
}

@Controller('review')
export class ReviewController {
  constructor(@Inject(ReviewService) private readonly reviewService: ReviewService) {}

  @Post('diff')
  async reviewDiff(@Body() dto: DiffReviewDto): Promise<ReviewResult> {
    return this.reviewService.reviewDiff(
      dto.repoPath,
      dto.baseBranch ?? 'main',
      dto.checks,
      dto.extraInstructions,
    );
  }

  @Post('file')
  async reviewFiles(@Body() dto: FileReviewDto): Promise<ReviewResult> {
    return this.reviewService.reviewFiles(
      dto.files,
      dto.checks,
      dto.extraInstructions,
    );
  }
}
