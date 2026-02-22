import { Module } from '@nestjs/common';
import { FilesystemController } from './filesystem.controller.js';

@Module({
  controllers: [FilesystemController],
})
export class FilesystemApiModule {}
