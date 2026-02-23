import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  app.setGlobalPrefix('api');
  // 限制 CORS 來源為 localhost 任意 port（本機開發工具）
  app.enableCors({ origin: /^http:\/\/localhost(:\d+)?$/, credentials: true });
  await app.listen(3100);
  console.log('API server running on http://localhost:3100');
}
bootstrap();
