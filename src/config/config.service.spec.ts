import { Test } from '@nestjs/testing';
import { ConfigService } from './config.service.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

describe('ConfigService', () => {
  let service: ConfigService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ConfigService],
    }).compile();
    service = module.get(ConfigService);
  });

  afterEach(() => {
    delete process.env.CONFIG_JSON;
    delete process.env.DECISION_MAKER_MODEL;
    delete process.env.REVIEW_LANGUAGE;
    delete process.env.DECISION_MAKER_TIMEOUT_MS;
    delete process.env.REVIEWER_TIMEOUT_MS;
    delete process.env.REVIEWER_EXPLORE_LOCAL;
  });

  it('should load config from file', async () => {
    const config = await service.loadConfig();
    expect(config.reviewers).toBeDefined();
    expect(config.reviewers.length).toBeGreaterThan(0);
    expect(config.decisionMaker).toBeDefined();
    expect(config.review.defaultChecks).toBeDefined();
  });

  it('should load config from custom path', async () => {
    const config = await service.loadConfig('./review-council.config.json');
    expect(config.reviewers[0].name).toBe('Gemini');
  });

  it('should throw when getConfig() called before loadConfig()', () => {
    expect(() => service.getConfig()).toThrow('Config not loaded. Call loadConfig() first.');
  });

  it('should return config after loadConfig()', async () => {
    await service.loadConfig();
    const config = service.getConfig();
    expect(config.reviewers).toBeDefined();
    expect(config.decisionMaker.name).toBe('Claude');
  });

  it('should throw on config missing required fields', async () => {
    const tmpPath = join(process.cwd(), '__test_invalid_config__.json');
    await writeFile(tmpPath, JSON.stringify({ reviewers: [] }));
    try {
      await expect(service.loadConfig(tmpPath)).rejects.toThrow('reviewers');
    } finally {
      await unlink(tmpPath);
    }
  });

  it('should throw on config with invalid reviewer (missing cliPath)', async () => {
    const tmpPath = join(process.cwd(), '__test_bad_reviewer__.json');
    await writeFile(tmpPath, JSON.stringify({
      reviewers: [{ name: 'Test' }],
      decisionMaker: { name: 'DM', cliPath: 'dm', cliArgs: [] },
      review: { defaultChecks: ['code-quality'], language: 'en' },
    }));
    try {
      await expect(service.loadConfig(tmpPath)).rejects.toThrow('cliPath');
    } finally {
      await unlink(tmpPath);
    }
  });

  const VALID_JSON_CONFIG = JSON.stringify({
    reviewers: [{ name: 'Test', cliPath: 'echo', cliArgs: [] }],
    decisionMaker: { name: 'DM', cliPath: 'echo', cliArgs: [] },
    review: { defaultChecks: ['code-quality'], language: 'en' },
  });

  describe('CONFIG_JSON env var', () => {
    it('should load config from CONFIG_JSON env var', async () => {
      process.env.CONFIG_JSON = VALID_JSON_CONFIG;
      const config = await service.loadConfig();
      expect(config.reviewers[0].name).toBe('Test');
      expect(config.decisionMaker.name).toBe('DM');
      expect(config.review.language).toBe('en');
    });

    it('should prefer --config flag over CONFIG_JSON', async () => {
      process.env.CONFIG_JSON = VALID_JSON_CONFIG;
      const config = await service.loadConfig('./review-council.config.json');
      expect(config.reviewers[0].name).toBe('Gemini');
    });

    it('should throw on invalid JSON in CONFIG_JSON', async () => {
      process.env.CONFIG_JSON = '{not valid json}';
      await expect(service.loadConfig()).rejects.toThrow(
        'Failed to parse CONFIG_JSON environment variable',
      );
    });

    it('should throw on valid JSON but invalid structure in CONFIG_JSON', async () => {
      process.env.CONFIG_JSON = JSON.stringify({ reviewers: [] });
      await expect(service.loadConfig()).rejects.toThrow('reviewers');
    });

    it('should fall through to default file when CONFIG_JSON is empty', async () => {
      process.env.CONFIG_JSON = '';
      const config = await service.loadConfig();
      expect(config.reviewers[0].name).toBe('Gemini');
    });
  });

  describe('env var overrides', () => {
    it('should override decisionMaker.model with DECISION_MAKER_MODEL', async () => {
      process.env.DECISION_MAKER_MODEL = 'gpt-4o';
      const config = await service.loadConfig();
      expect(config.decisionMaker.model).toBe('gpt-4o');
    });

    it('should override review.language with REVIEW_LANGUAGE', async () => {
      process.env.REVIEW_LANGUAGE = 'ja';
      const config = await service.loadConfig();
      expect(config.review.language).toBe('ja');
    });

    it('should apply env overrides on top of CONFIG_JSON', async () => {
      process.env.CONFIG_JSON = VALID_JSON_CONFIG;
      process.env.REVIEW_LANGUAGE = 'fr';
      const config = await service.loadConfig();
      expect(config.reviewers[0].name).toBe('Test');
      expect(config.review.language).toBe('fr');
    });

    it('should not override when env var is empty string', async () => {
      process.env.DECISION_MAKER_MODEL = '';
      process.env.REVIEW_LANGUAGE = '  ';
      const config = await service.loadConfig();
      expect(config.decisionMaker.model).toBeUndefined();
      expect(config.review.language).toBe('zh-tw');
    });

    it('should apply both overrides simultaneously', async () => {
      process.env.DECISION_MAKER_MODEL = 'custom-model';
      process.env.REVIEW_LANGUAGE = 'ko';
      const config = await service.loadConfig();
      expect(config.decisionMaker.model).toBe('custom-model');
      expect(config.review.language).toBe('ko');
    });

    it('should override decisionMaker.timeoutMs with DECISION_MAKER_TIMEOUT_MS', async () => {
      process.env.DECISION_MAKER_TIMEOUT_MS = '600000';
      const config = await service.loadConfig();
      expect(config.decisionMaker.timeoutMs).toBe(600000);
    });

    it('should override all reviewers timeoutMs with REVIEWER_TIMEOUT_MS', async () => {
      process.env.REVIEWER_TIMEOUT_MS = '400000';
      const config = await service.loadConfig();
      for (const r of config.reviewers) {
        expect(r.timeoutMs).toBe(400000);
      }
    });

    it('should ignore non-numeric DECISION_MAKER_TIMEOUT_MS', async () => {
      process.env.CONFIG_JSON = VALID_JSON_CONFIG;
      process.env.DECISION_MAKER_TIMEOUT_MS = 'abc';
      const config = await service.loadConfig();
      expect(config.decisionMaker.timeoutMs).toBeUndefined();
    });

    it('should set allowLocalExploration=true with REVIEWER_EXPLORE_LOCAL=true', async () => {
      process.env.REVIEWER_EXPLORE_LOCAL = 'true';
      const config = await service.loadConfig();
      expect(config.review.allowLocalExploration).toBe(true);
    });

    it('should set allowLocalExploration=false with REVIEWER_EXPLORE_LOCAL=false', async () => {
      process.env.REVIEWER_EXPLORE_LOCAL = 'false';
      const config = await service.loadConfig();
      expect(config.review.allowLocalExploration).toBe(false);
    });

    it('should accept REVIEWER_EXPLORE_LOCAL=1 as true', async () => {
      process.env.REVIEWER_EXPLORE_LOCAL = '1';
      const config = await service.loadConfig();
      expect(config.review.allowLocalExploration).toBe(true);
    });

    it('should not override allowLocalExploration=true when REVIEWER_EXPLORE_LOCAL is empty', async () => {
      process.env.CONFIG_JSON = JSON.stringify({
        reviewers: [{ name: 'Test', cliPath: 'echo', cliArgs: [] }],
        decisionMaker: { name: 'DM', cliPath: 'echo', cliArgs: [] },
        review: { defaultChecks: ['code-quality'], language: 'en', allowLocalExploration: true },
      });
      process.env.REVIEWER_EXPLORE_LOCAL = '';
      const config = await service.loadConfig();
      expect(config.review.allowLocalExploration).toBe(true);
    });

    it('should not override allowLocalExploration=false when REVIEWER_EXPLORE_LOCAL is empty', async () => {
      process.env.CONFIG_JSON = JSON.stringify({
        reviewers: [{ name: 'Test', cliPath: 'echo', cliArgs: [] }],
        decisionMaker: { name: 'DM', cliPath: 'echo', cliArgs: [] },
        review: { defaultChecks: ['code-quality'], language: 'en', allowLocalExploration: false },
      });
      process.env.REVIEWER_EXPLORE_LOCAL = '';
      const config = await service.loadConfig();
      expect(config.review.allowLocalExploration).toBe(false);
    });
  });

  describe('new field validation', () => {
    it('should reject negative timeoutMs', async () => {
      const tmpPath = join(process.cwd(), '__test_bad_timeout__.json');
      await writeFile(tmpPath, JSON.stringify({
        reviewers: [{ name: 'Test', cliPath: 'echo', cliArgs: [], timeoutMs: -1 }],
        decisionMaker: { name: 'DM', cliPath: 'echo', cliArgs: [] },
        review: { defaultChecks: ['code-quality'], language: 'en' },
      }));
      try {
        await expect(service.loadConfig(tmpPath)).rejects.toThrow('timeoutMs');
      } finally {
        await unlink(tmpPath);
      }
    });

    it('should reject maxRetries > 5', async () => {
      const tmpPath = join(process.cwd(), '__test_bad_retries__.json');
      await writeFile(tmpPath, JSON.stringify({
        reviewers: [{ name: 'Test', cliPath: 'echo', cliArgs: [], maxRetries: 6 }],
        decisionMaker: { name: 'DM', cliPath: 'echo', cliArgs: [] },
        review: { defaultChecks: ['code-quality'], language: 'en' },
      }));
      try {
        await expect(service.loadConfig(tmpPath)).rejects.toThrow('maxRetries');
      } finally {
        await unlink(tmpPath);
      }
    });

    it('should accept valid timeoutMs and maxRetries', async () => {
      const tmpPath = join(process.cwd(), '__test_valid_new_fields__.json');
      await writeFile(tmpPath, JSON.stringify({
        reviewers: [{ name: 'Test', cliPath: 'echo', cliArgs: [], timeoutMs: 300000, maxRetries: 2 }],
        decisionMaker: { name: 'DM', cliPath: 'echo', cliArgs: [], timeoutMs: 600000, maxRetries: 1 },
        review: { defaultChecks: ['code-quality'], language: 'en', maxReviewsLength: 60000, maxCodeLength: 100000, maxSummaryLength: 60000 },
      }));
      try {
        const config = await service.loadConfig(tmpPath);
        expect(config.reviewers[0].timeoutMs).toBe(300000);
        expect(config.reviewers[0].maxRetries).toBe(2);
        expect(config.decisionMaker.timeoutMs).toBe(600000);
        expect(config.review.maxReviewsLength).toBe(60000);
        expect(config.review.maxCodeLength).toBe(100000);
        expect(config.review.maxSummaryLength).toBe(60000);
      } finally {
        await unlink(tmpPath);
      }
    });
  });
});
