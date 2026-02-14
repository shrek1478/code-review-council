import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';
import { CodeReaderService } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { SummarizerService } from './summarizer.service.js';

@Module({
  controllers: [ReviewController],
  providers: [ReviewService, CodeReaderService, CouncilService, SummarizerService],
  exports: [ReviewService],
})
export class ReviewModule {}
