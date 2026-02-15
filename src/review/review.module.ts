import { Module, ConsoleLogger } from '@nestjs/common';
import { ReviewService } from './review.service.js';
import { CodeReaderService } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { DecisionMakerService } from './decision-maker.service.js';

@Module({
  providers: [
    ConsoleLogger,
    ReviewService,
    CodeReaderService,
    CouncilService,
    DecisionMakerService,
  ],
  exports: [ReviewService],
})
export class ReviewModule {}
