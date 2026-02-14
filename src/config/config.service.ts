import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CouncilConfig } from './config.types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

@Injectable()
export class ConfigService {
  private config: CouncilConfig | null = null;

  async loadConfig(configPath?: string): Promise<CouncilConfig> {
    const filePath = configPath
      ? resolve(configPath)
      : resolve(PROJECT_ROOT, 'review-council.config.json');
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
