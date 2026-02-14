import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CouncilConfig } from './config.types.js';

@Injectable()
export class ConfigService {
  private config: CouncilConfig | null = null;

  async loadConfig(configPath?: string): Promise<CouncilConfig> {
    const filePath = resolve(configPath ?? 'review-council.config.json');
    const content = await readFile(filePath, 'utf-8');
    this.config = JSON.parse(content) as CouncilConfig;
    return this.config;
  }

  getConfig(): CouncilConfig {
    if (!this.config) {
      throw new Error('Config not loaded. Call loadConfig() first.');
    }
    return this.config;
  }
}
