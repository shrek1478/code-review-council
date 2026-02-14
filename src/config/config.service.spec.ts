import { Test } from '@nestjs/testing';
import { ConfigService } from './config.service.js';
import { describe, it, expect, beforeEach } from 'vitest';

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
    expect(config.summarizer).toBeDefined();
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
    expect(config.summarizer.name).toBe('Claude');
  });
});
