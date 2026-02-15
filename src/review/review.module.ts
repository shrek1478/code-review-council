import { Module, ConsoleLogger, Scope } from '@nestjs/common';
import { ReviewService } from './review.service.js';
import { CodeReaderService } from './code-reader.service.js';
import { CouncilService } from './council.service.js';
import { DecisionMakerService } from './decision-maker.service.js';

@Module({
  providers: [
    { provide: ConsoleLogger, useClass: ConsoleLogger, scope: Scope.TRANSIENT },
    ReviewService,
    CodeReaderService,
    CouncilService,
    DecisionMakerService,
  ],
  exports: [ReviewService],
})
export class ReviewModule {}
