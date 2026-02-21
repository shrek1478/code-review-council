import { Controller, Get, Post, Body } from '@nestjs/common';
import { ConfigService } from '../../../../src/config/config.service.js';

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getConfig() {
    return this.configService.getConfig();
  }

  @Post('validate')
  validateConfig(@Body() body: Record<string, unknown>) {
    try {
      // Basic structural validation
      if (!body.reviewers || !Array.isArray(body.reviewers)) {
        return { valid: false, error: 'reviewers must be an array' };
      }
      if (!body.decisionMaker || typeof body.decisionMaker !== 'object') {
        return { valid: false, error: 'decisionMaker is required' };
      }
      if (!body.review || typeof body.review !== 'object') {
        return { valid: false, error: 'review settings are required' };
      }
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid config',
      };
    }
  }
}
