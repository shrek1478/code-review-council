import { Injectable, ConsoleLogger, Inject } from '@nestjs/common';
import { readFile, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { CouncilConfig } from './config.types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const USER_CONFIG_DIR = join(homedir(), '.code-review-council');
const USER_CONFIG_PATH = join(USER_CONFIG_DIR, 'review-council.config.json');
const CWD_CONFIG_PATH = resolve('review-council.config.json');

@Injectable()
export class ConfigService {
  private config: CouncilConfig | null = null;

  constructor(@Inject(ConsoleLogger) private readonly logger: ConsoleLogger) {
    this.logger.setContext(ConfigService.name);
  }

  async loadConfig(configPath?: string): Promise<CouncilConfig> {
    const { parsed, source } = await this.resolveBaseConfig(configPath);
    const config = parsed as CouncilConfig;
    this.applyEnvOverrides(config);
    this.validateConfig(config, source);
    this.config = config;
    return this.config;
  }

  private async resolveBaseConfig(
    configPath?: string,
  ): Promise<{ parsed: unknown; source: string }> {
    // 1. CLI --config 指定路徑
    if (configPath) {
      return this.loadFromFile(resolve(configPath));
    }
    // 2. CONFIG_JSON 環境變數
    const configJson = process.env.CONFIG_JSON;
    if (configJson && configJson.trim() !== '') {
      return this.parseConfigJson(configJson);
    }
    // 3. 專案層級：當前工作目錄下的設定檔
    if (await this.fileExists(CWD_CONFIG_PATH)) {
      return this.loadFromFile(CWD_CONFIG_PATH);
    }
    // 4. 使用者層級：~/.code-review-council/review-council.config.json
    if (await this.fileExists(USER_CONFIG_PATH)) {
      return this.loadFromFile(USER_CONFIG_PATH);
    }
    // 5. 內建預設
    return this.loadFromFile(
      resolve(PROJECT_ROOT, 'review-council.config.json'),
    );
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
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

  private parseConfigJson(configJson: string): {
    parsed: unknown;
    source: string;
  } {
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

  private static readonly SAFE_LANGUAGE = /^[a-zA-Z-]{2,10}$/;
  private static readonly SAFE_MODEL = /^[^\n\r]{1,100}$/;

  private applyEnvOverrides(config: CouncilConfig): void {
    const model = process.env.DECISION_MAKER_MODEL;
    if (model && model.trim() !== '' && config.decisionMaker) {
      const trimmed = model.trim();
      if (ConfigService.SAFE_MODEL.test(trimmed)) {
        config.decisionMaker.model = trimmed;
      } else {
        this.logger.warn(
          'Ignoring invalid DECISION_MAKER_MODEL env (must be 1-100 chars, no newlines)',
        );
      }
    }
    const language = process.env.REVIEW_LANGUAGE;
    if (language && language.trim() !== '' && config.review) {
      const trimmed = language.trim();
      if (ConfigService.SAFE_LANGUAGE.test(trimmed)) {
        config.review.language = trimmed;
      } else {
        this.logger.warn(
          'Ignoring invalid REVIEW_LANGUAGE env (must be 2-10 alpha/dash chars)',
        );
      }
    }
    const dmTimeout = process.env.DECISION_MAKER_TIMEOUT_MS;
    if (dmTimeout && dmTimeout.trim() !== '' && config.decisionMaker) {
      const parsed = Number(dmTimeout.trim());
      if (Number.isInteger(parsed) && parsed > 0) {
        config.decisionMaker.timeoutMs = parsed;
      }
    }
    const reviewerTimeout = process.env.REVIEWER_TIMEOUT_MS;
    if (
      reviewerTimeout &&
      reviewerTimeout.trim() !== '' &&
      Array.isArray(config.reviewers)
    ) {
      const parsed = Number(reviewerTimeout.trim());
      if (Number.isInteger(parsed) && parsed > 0) {
        for (const r of config.reviewers) {
          r.timeoutMs = parsed;
        }
      }
    }
    const exploreLocal = process.env.REVIEWER_EXPLORE_LOCAL;
    if (exploreLocal && exploreLocal.trim() !== '' && config.review) {
      const val = exploreLocal.trim().toLowerCase();
      if (val === 'true' || val === '1') {
        config.review.mode = 'explore';
      } else if (val === 'false' || val === '0') {
        config.review.mode = 'inline';
      }
    }
  }

  getConfig(): CouncilConfig {
    if (!this.config) {
      throw new Error('Config not loaded. Call loadConfig() first.');
    }
    return this.config;
  }

  private validateConfig(config: any, filePath: string): void {
    if (!Array.isArray(config.reviewers) || config.reviewers.length === 0) {
      throw new Error(
        `Invalid config (${filePath}): "reviewers" must be a non-empty array`,
      );
    }
    const reviewerNames = new Set<string>();
    for (const [i, r] of config.reviewers.entries()) {
      this.validateReviewerConfig(r, `reviewers[${i}]`, filePath);
      if (r.name && reviewerNames.has(r.name)) {
        throw new Error(
          `Invalid config (${filePath}): duplicate reviewer name "${r.name}"`,
        );
      }
      if (r.name) reviewerNames.add(r.name);
    }
    if (!config.decisionMaker) {
      throw new Error(
        `Invalid config (${filePath}): "decisionMaker" is required`,
      );
    }
    this.validateReviewerConfig(
      config.decisionMaker,
      'decisionMaker',
      filePath,
    );
    if (!config.review || !Array.isArray(config.review.defaultChecks)) {
      throw new Error(
        `Invalid config (${filePath}): "review.defaultChecks" must be an array`,
      );
    }
    if (
      !config.review.defaultChecks.every(
        (c: unknown) => typeof c === 'string' && c.trim() !== '',
      )
    ) {
      throw new Error(
        `Invalid config (${filePath}): "review.defaultChecks" elements must be non-empty strings`,
      );
    }
    if (
      typeof config.review.language !== 'string' ||
      config.review.language.trim() === ''
    ) {
      throw new Error(
        `Invalid config (${filePath}): "review.language" must be a non-empty string`,
      );
    }
    const MAX_LENGTH_LIMIT = 500_000;
    for (const field of [
      'maxReviewsLength',
      'maxCodeLength',
      'maxSummaryLength',
    ] as const) {
      if (config.review[field] !== undefined) {
        if (
          !Number.isInteger(config.review[field]) ||
          config.review[field] <= 0 ||
          config.review[field] > MAX_LENGTH_LIMIT
        ) {
          throw new Error(
            `Invalid config (${filePath}): "review.${field}" must be a positive integer up to ${MAX_LENGTH_LIMIT}`,
          );
        }
      }
    }
    // Backward compatibility: convert deprecated allowLocalExploration to mode
    if (config.review.allowLocalExploration !== undefined) {
      if (typeof config.review.allowLocalExploration !== 'boolean') {
        throw new Error(
          `Invalid config (${filePath}): "review.allowLocalExploration" must be a boolean`,
        );
      }
      if (config.review.mode === undefined) {
        config.review.mode = config.review.allowLocalExploration
          ? 'explore'
          : 'inline';
        this.logger.warn(
          `"review.allowLocalExploration" is deprecated — use "review.mode": "${config.review.mode}" instead`,
        );
      }
      delete config.review.allowLocalExploration;
    }
    if (
      config.review.mode !== undefined &&
      config.review.mode !== 'inline' &&
      config.review.mode !== 'explore'
    ) {
      throw new Error(
        `Invalid config (${filePath}): "review.mode" must be "inline" or "explore"`,
      );
    }
    if (config.review.extensions !== undefined) {
      if (
        !Array.isArray(config.review.extensions) ||
        !config.review.extensions.every((e: unknown) => typeof e === 'string')
      ) {
        throw new Error(
          `Invalid config (${filePath}): "review.extensions" must be an array of strings`,
        );
      }
    }
    if (config.review.sensitivePatterns !== undefined) {
      if (
        !Array.isArray(config.review.sensitivePatterns) ||
        !config.review.sensitivePatterns.every(
          (p: unknown) => typeof p === 'string',
        )
      ) {
        throw new Error(
          `Invalid config (${filePath}): "review.sensitivePatterns" must be an array of strings`,
        );
      }
      const MAX_SENSITIVE_PATTERNS = 20;
      if (config.review.sensitivePatterns.length > MAX_SENSITIVE_PATTERNS) {
        throw new Error(
          `Invalid config (${filePath}): "review.sensitivePatterns" exceeds maximum of ${MAX_SENSITIVE_PATTERNS} entries`,
        );
      }
      for (const p of config.review.sensitivePatterns) {
        let regex: RegExp;
        try {
          regex = new RegExp(p);
        } catch {
          throw new Error(
            `Invalid config (${filePath}): "review.sensitivePatterns" contains invalid regex: "${p}"`,
          );
        }
        // ReDoS safety: test each pattern against a worst-case string with time limit
        if (this.isReDoSRisk(regex)) {
          throw new Error(
            `Invalid config (${filePath}): "review.sensitivePatterns" regex "${p}" is potentially unsafe (ReDoS risk). ` +
              `Avoid nested quantifiers like (a+)+ or (a|a)*b.`,
          );
        }
      }
    }
  }

  /**
   * Detect patterns that can cause catastrophic backtracking (ReDoS).
   * Note: This is a heuristic check and cannot catch all possible ReDoS patterns.
   * It covers nested quantifiers — the most common and dangerous ReDoS trigger.
   * Simple quantified alternation like (foo|bar)+ is NOT flagged because it
   * rarely causes backtracking in practice (branches with distinct prefixes).
   */
  private isReDoSRisk(regex: RegExp): boolean {
    const src = regex.source;
    // Nested quantifiers: (...)+ followed by +, *, or {n,}
    // e.g. (a+)+, (a*)+, (a+)*, ([^x]+)+, (a+|b)+
    if (/\([^)]*[+*][^)]*\)[+*{]/.test(src)) return true;
    return false;
  }

  private validateReviewerConfig(r: any, path: string, filePath: string): void {
    if (!r.name || typeof r.name !== 'string') {
      throw new Error(
        `Invalid config (${filePath}): "${path}.name" is required`,
      );
    }
    if (!r.cliPath || typeof r.cliPath !== 'string') {
      throw new Error(
        `Invalid config (${filePath}): "${path}.cliPath" is required`,
      );
    }
    if (!Array.isArray(r.cliArgs)) {
      throw new Error(
        `Invalid config (${filePath}): "${path}.cliArgs" must be an array`,
      );
    }
    if (!r.cliArgs.every((a: unknown) => typeof a === 'string')) {
      throw new Error(
        `Invalid config (${filePath}): "${path}.cliArgs" elements must be strings`,
      );
    }
    // Whitelist: only allow simple command names (letters, digits, dots, hyphens, underscores)
    const CLI_PATH_PATTERN = /^[A-Za-z0-9._-]+$/;
    const trimmed = r.cliPath.trim();
    if (
      !CLI_PATH_PATTERN.test(trimmed) ||
      trimmed.startsWith('-') ||
      trimmed === '.' ||
      trimmed === '..'
    ) {
      throw new Error(
        `Invalid config (${filePath}): "${path}.cliPath" value "${r.cliPath}" is not a valid command name. ` +
          `Only simple command names resolvable via PATH are allowed (e.g. "gemini", "copilot", "codex-acp", "claude-code-acp").`,
      );
    }
    r.cliPath = trimmed;
    if (r.protocol !== undefined) {
      if (r.protocol !== 'acp' && r.protocol !== 'copilot') {
        throw new Error(
          `Invalid config (${filePath}): "${path}.protocol" must be "acp" or "copilot" if provided`,
        );
      }
    }
    if (r.model !== undefined) {
      if (
        typeof r.model !== 'string' ||
        !ConfigService.SAFE_MODEL.test(r.model)
      ) {
        throw new Error(
          `Invalid config (${filePath}): "${path}.model" must be a string of 1-100 chars with no newlines`,
        );
      }
    }
    if (r.timeoutMs !== undefined) {
      if (!Number.isInteger(r.timeoutMs) || r.timeoutMs <= 0) {
        throw new Error(
          `Invalid config (${filePath}): "${path}.timeoutMs" must be a positive integer`,
        );
      }
    }
    if (r.maxRetries !== undefined) {
      if (
        !Number.isInteger(r.maxRetries) ||
        r.maxRetries < 0 ||
        r.maxRetries > 5
      ) {
        throw new Error(
          `Invalid config (${filePath}): "${path}.maxRetries" must be an integer between 0 and 5`,
        );
      }
    }
  }
}
