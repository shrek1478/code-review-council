import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeErrorMessage,
  isRetryable,
  retryWithBackoff,
} from './retry-utils.js';

describe('sanitizeErrorMessage', () => {
  it('should mask long base64-like tokens', () => {
    const token = 'A'.repeat(40);
    const result = sanitizeErrorMessage(new Error(`token: ${token}`));
    expect(result).toBe('token: [REDACTED]');
  });

  it('should preserve UUIDs', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = sanitizeErrorMessage(new Error(`id: ${uuid}`));
    expect(result).toContain(uuid);
  });

  it('should mask common secret prefixes', () => {
    expect(sanitizeErrorMessage(new Error('key=sk-abc123'))).toBe(
      'key=[REDACTED]',
    );
    expect(sanitizeErrorMessage(new Error('token=ghp_shorttoken'))).toBe(
      'token=[REDACTED]',
    );
    expect(sanitizeErrorMessage(new Error('pat=glpat-abcdef'))).toBe(
      'pat=[REDACTED]',
    );
  });

  it('should handle non-Error values', () => {
    expect(sanitizeErrorMessage('plain string')).toBe('plain string');
    expect(sanitizeErrorMessage(42)).toBe('42');
    expect(sanitizeErrorMessage(null)).toBe('null');
  });

  it('should leave short safe strings untouched', () => {
    const msg = 'Connection refused';
    expect(sanitizeErrorMessage(new Error(msg))).toBe(msg);
  });
});

describe('isRetryable', () => {
  it('should return false for non-Error values', () => {
    expect(isRetryable('string error')).toBe(false);
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(42)).toBe(false);
  });

  it('should return true for retryable error codes', () => {
    for (const code of ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN']) {
      const err = new Error('fail') as NodeJS.ErrnoException;
      err.code = code;
      expect(isRetryable(err)).toBe(true);
    }
  });

  it('should return false for non-retryable error codes', () => {
    for (const code of ['ERR_INVALID_TOKEN', 'ERR_UNAUTHORIZED', 'ERR_AUTHENTICATION']) {
      const err = new Error('fail') as NodeJS.ErrnoException;
      err.code = code;
      expect(isRetryable(err)).toBe(false);
    }
  });

  it('should return true for retryable message patterns', () => {
    expect(isRetryable(new Error('Request timed out'))).toBe(true);
    expect(isRetryable(new Error('Connection timeout'))).toBe(true);
    expect(isRetryable(new Error('empty response from server'))).toBe(true);
    expect(isRetryable(new Error('socket hang up'))).toBe(true);
    expect(isRetryable(new Error('ECONNRESET in message'))).toBe(true);
  });

  it('should return false for non-retryable message patterns', () => {
    expect(isRetryable(new Error('invalid token provided'))).toBe(false);
    expect(isRetryable(new Error('unauthorized access'))).toBe(false);
    expect(isRetryable(new Error('authentication failed'))).toBe(false);
  });

  it('should return false for unrecognized errors', () => {
    expect(isRetryable(new Error('something unexpected'))).toBe(false);
  });

  it('should prefer code over message pattern', () => {
    const err = new Error('timed out') as NodeJS.ErrnoException;
    err.code = 'ERR_INVALID_TOKEN';
    expect(isRetryable(err)).toBe(false);
  });
});

describe('retryWithBackoff', () => {
  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const logger = { warn: vi.fn() };
    const result = await retryWithBackoff(fn, {
      maxRetries: 2,
      label: 'test',
      logger,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throw immediately for non-retryable errors', async () => {
    const err = new Error('invalid token') as NodeJS.ErrnoException;
    err.code = 'ERR_INVALID_TOKEN';
    const fn = vi.fn().mockRejectedValue(err);
    const logger = { warn: vi.fn() };
    await expect(
      retryWithBackoff(fn, { maxRetries: 3, label: 'test', logger }),
    ).rejects.toThrow('invalid token');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable errors and succeed', async () => {
    const retryableErr = new Error('timed out');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableErr)
      .mockResolvedValue('recovered');
    const logger = { warn: vi.fn() };
    const result = await retryWithBackoff(fn, {
      maxRetries: 2,
      label: 'test',
      logger,
    });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('should throw after exhausting retries', async () => {
    const retryableErr = new Error('timeout');
    const fn = vi.fn().mockRejectedValue(retryableErr);
    const logger = { warn: vi.fn() };
    await expect(
      retryWithBackoff(fn, { maxRetries: 1, label: 'test', logger }),
    ).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should call onRetry callback between retries', async () => {
    const retryableErr = new Error('socket hang up');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableErr)
      .mockResolvedValue('ok');
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const logger = { warn: vi.fn() };
    await retryWithBackoff(fn, {
      maxRetries: 1,
      label: 'test',
      logger,
      onRetry,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should abort if onRetry throws', async () => {
    const retryableErr = new Error('timeout');
    const fn = vi.fn().mockRejectedValue(retryableErr);
    const onRetryErr = new Error('onRetry failed');
    const onRetry = vi.fn().mockRejectedValue(onRetryErr);
    const logger = { warn: vi.fn() };
    await expect(
      retryWithBackoff(fn, {
        maxRetries: 2,
        label: 'test',
        logger,
        onRetry,
      }),
    ).rejects.toThrow('onRetry failed');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should not retry when maxRetries is 0', async () => {
    const retryableErr = new Error('timeout');
    const fn = vi.fn().mockRejectedValue(retryableErr);
    const logger = { warn: vi.fn() };
    await expect(
      retryWithBackoff(fn, { maxRetries: 0, label: 'test', logger }),
    ).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
