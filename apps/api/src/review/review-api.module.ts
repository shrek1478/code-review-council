import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller.js';
import { ReviewSseService } from './review-sse.service.js';
import { ReviewModule } from '../../../../src/review/review.module.js';

@Module({
  imports: [ReviewModule],
  controllers: [ReviewController],
  providers: [ReviewSseService],
})
export class ReviewApiModule {}
