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
    return this.configService.validateConfigData(body);
  }
}
