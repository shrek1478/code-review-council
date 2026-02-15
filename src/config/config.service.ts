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
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      const msg = error instanceof SyntaxError ? error.message : String(error);
      throw new Error(`Failed to parse config file "${filePath}": ${msg}`);
    }
    this.validateConfig(parsed, filePath);
    this.config = parsed as CouncilConfig;
    return this.config;
  }

  getConfig(): CouncilConfig {
    if (!this.config) {
      throw new Error('Config not loaded. Call loadConfig() first.');
    }
    return this.config;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime validation on untrusted JSON
  private validateConfig(config: any, filePath: string): void {
    if (!Array.isArray(config.reviewers) || config.reviewers.length === 0) {
      throw new Error(`Invalid config (${filePath}): "reviewers" must be a non-empty array`);
    }
    for (const [i, r] of config.reviewers.entries()) {
      this.validateReviewerConfig(r, `reviewers[${i}]`, filePath);
    }
    if (!config.decisionMaker) {
      throw new Error(`Invalid config (${filePath}): "decisionMaker" is required`);
    }
    this.validateReviewerConfig(config.decisionMaker, 'decisionMaker', filePath);
    if (!config.review || !Array.isArray(config.review.defaultChecks)) {
      throw new Error(`Invalid config (${filePath}): "review.defaultChecks" must be an array`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime validation on untrusted JSON
  private validateReviewerConfig(r: any, path: string, filePath: string): void {
    if (!r.name || typeof r.name !== 'string') {
      throw new Error(`Invalid config (${filePath}): "${path}.name" is required`);
    }
    if (!r.cliPath || typeof r.cliPath !== 'string') {
      throw new Error(`Invalid config (${filePath}): "${path}.cliPath" is required`);
    }
    if (!Array.isArray(r.cliArgs)) {
      throw new Error(`Invalid config (${filePath}): "${path}.cliArgs" must be an array`);
    }
    if (!r.cliArgs.every((a: unknown) => typeof a === 'string')) {
      throw new Error(`Invalid config (${filePath}): "${path}.cliArgs" elements must be strings`);
    }
  }
}
