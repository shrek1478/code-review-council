import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';
import { CodeReaderService } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { DecisionMakerService } from './decision-maker.service.js';

@Module({
  controllers: [ReviewController],
  providers: [ReviewService, CodeReaderService, CouncilService, DecisionMakerService],
  exports: [ReviewService],
})
export class ReviewModule {}
