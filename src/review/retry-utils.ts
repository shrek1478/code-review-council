export interface RetryOptions {
  maxRetries: number;
  label: string;
  logger: { warn(message: string): void };
  onRetry?: () => Promise<void>;
}

const NON_RETRYABLE_CODES = new Set(['ERR_INVALID_TOKEN', 'ERR_UNAUTHORIZED', 'ERR_AUTHENTICATION']);
const RETRYABLE_CODES = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN',
]);

const NON_RETRYABLE_PATTERNS = ['invalid token', 'unauthorized', 'authentication'];
const RETRYABLE_PATTERNS = [
  'timed out',
  'timeout',
  'empty response',
  'failed to list models',
  'econnreset',
  'econnrefused',
  'socket hang up',
];

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Prefer structured error code if available
  const code = (error as NodeJS.ErrnoException).code;
  if (code) {
    if (NON_RETRYABLE_CODES.has(code)) return false;
    if (RETRYABLE_CODES.has(code)) return true;
  }
  // Fallback to message pattern matching
  const msg = error.message.toLowerCase();
  if (NON_RETRYABLE_PATTERNS.some((p) => msg.includes(p))) return false;
  return RETRYABLE_PATTERNS.some((p) => msg.includes(p));
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxRetries, label, logger, onRetry } = options;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < maxRetries && isRetryable(error)) {
        const delay = 2000 * Math.pow(2, attempt);
        logger.warn(`${label} attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        if (onRetry) await onRetry();
        continue;
      }
      throw error;
    }
  }
  throw new Error(`${label} exhausted all retries`);
}
