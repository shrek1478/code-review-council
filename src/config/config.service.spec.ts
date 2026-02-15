import { Test } from '@nestjs/testing';
import { ConfigService } from './config.service.js';
import { describe, it, expect, beforeEach } from 'vitest';
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

  it('should load config from file', async () => {
    const config = await service.loadConfig();
    expect(config.reviewers).toBeDefined();
    expect(config.reviewers.length).toBeGreaterThan(0);
    expect(config.decisionMaker).toBeDefined();
    expect(config.review.defaultChecks).toBeDefined();
  });

  it('should load config from custom path', async () => {
    const config = await service.loadConfig('./review-council.config.json');
    expect(config.reviewers[0].name).toBe('Codex');
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
});
