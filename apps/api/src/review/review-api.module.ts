import { Module } from '@nestjs/common';
import { ReviewGateway } from './review.gateway.js';
import { ReviewModule } from '../../../../src/review/review.module.js';

@Module({
  imports: [ReviewModule],
  providers: [ReviewGateway],
})
export class ReviewApiModule {}
