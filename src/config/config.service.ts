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
    const { parsed, source } = await this.resolveBaseConfig(configPath);
    this.validateConfig(parsed, source);
    const config = parsed as CouncilConfig;
    this.applyEnvOverrides(config);
    this.config = config;
    return this.config;
  }

  private async resolveBaseConfig(
    configPath?: string,
  ): Promise<{ parsed: unknown; source: string }> {
    if (configPath) {
      return this.loadFromFile(resolve(configPath));
    }
    const configJson = process.env.CONFIG_JSON;
    if (configJson && configJson.trim() !== '') {
      return this.parseConfigJson(configJson);
    }
    return this.loadFromFile(resolve(PROJECT_ROOT, 'review-council.config.json'));
  }

  private async loadFromFile(
    filePath: string,
  ): Promise<{ parsed: unknown; source: string }> {
    const content = await readFile(filePath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      const msg = error instanceof SyntaxError ? error.message : String(error);
      throw new Error(`Failed to parse config file "${filePath}": ${msg}`);
    }
    return { parsed, source: filePath };
  }

  private parseConfigJson(
    configJson: string,
  ): { parsed: unknown; source: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configJson);
    } catch (error) {
      const msg = error instanceof SyntaxError ? error.message : String(error);
      throw new Error(
        `Failed to parse CONFIG_JSON environment variable: ${msg}`,
      );
    }
    return { parsed, source: 'CONFIG_JSON env' };
  }

  private applyEnvOverrides(config: CouncilConfig): void {
    const model = process.env.DECISION_MAKER_MODEL;
    if (model && model.trim() !== '') {
      config.decisionMaker.model = model.trim();
    }
    const language = process.env.REVIEW_LANGUAGE;
    if (language && language.trim() !== '') {
      config.review.language = language.trim();
    }
    const dmTimeout = process.env.DECISION_MAKER_TIMEOUT_MS;
    if (dmTimeout && dmTimeout.trim() !== '') {
      const parsed = Number(dmTimeout.trim());
      if (Number.isInteger(parsed) && parsed > 0) {
        config.decisionMaker.timeoutMs = parsed;
      }
    }
    const reviewerTimeout = process.env.REVIEWER_TIMEOUT_MS;
    if (reviewerTimeout && reviewerTimeout.trim() !== '') {
      const parsed = Number(reviewerTimeout.trim());
      if (Number.isInteger(parsed) && parsed > 0) {
        for (const r of config.reviewers) {
          r.timeoutMs = parsed;
        }
      }
    }
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
    if (r.model !== undefined && typeof r.model !== 'string') {
      throw new Error(`Invalid config (${filePath}): "${path}.model" must be a string if provided`);
    }
    if (r.timeoutMs !== undefined) {
      if (!Number.isInteger(r.timeoutMs) || r.timeoutMs <= 0) {
        throw new Error(`Invalid config (${filePath}): "${path}.timeoutMs" must be a positive integer`);
      }
    }
    if (r.maxRetries !== undefined) {
      if (!Number.isInteger(r.maxRetries) || r.maxRetries < 0 || r.maxRetries > 5) {
        throw new Error(`Invalid config (${filePath}): "${path}.maxRetries" must be an integer between 0 and 5`);
      }
    }
  }
}
