import { describe, it, expect } from 'vitest';
import { isWithinRoot } from './path-utils.js';

describe('isWithinRoot', () => {
  it('should return true for paths within root', () => {
    expect(isWithinRoot('/root/sub/file.ts', '/root')).toBe(true);
  });

  it('should return true for deeply nested paths', () => {
    expect(isWithinRoot('/root/a/b/c/d.ts', '/root')).toBe(true);
  });

  it('should return false for paths outside root', () => {
    expect(isWithinRoot('/other/file.ts', '/root')).toBe(false);
  });

  it('should return false for parent traversal attempts', () => {
    expect(isWithinRoot('/root/../etc/passwd', '/root')).toBe(false);
  });

  it('should return true when target equals root', () => {
    expect(isWithinRoot('/root', '/root')).toBe(true);
  });

  it('should return false for sibling directories with similar prefix', () => {
    expect(isWithinRoot('/root-extra/file.ts', '/root')).toBe(false);
  });
});
