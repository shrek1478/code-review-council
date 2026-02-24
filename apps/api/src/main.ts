import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // In API mode, skip CWD config to avoid loading untrusted repo configs
  process.env.CRC_SKIP_CWD_CONFIG = '1';

  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  app.setGlobalPrefix('api');
  // 限制 CORS 來源為 localhost 任意 port（本機開發工具）
  app.enableCors({ origin: /^http:\/\/localhost(:\d+)?$/, credentials: true });
  await app.listen(3100, '127.0.0.1');
  const logger = new Logger('Bootstrap');
  logger.log('API server running on http://localhost:3100');
}
bootstrap();
