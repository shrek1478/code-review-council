import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from './config/config.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  await configService.loadConfig();
  await app.listen(3000);
  console.log('Code Review Council API running on http://localhost:3000');
}
bootstrap();
