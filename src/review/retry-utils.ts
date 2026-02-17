export interface RetryOptions {
  maxRetries: number;
  label: string;
  logger: { warn(message: string): void };
  onRetry?: () => Promise<void>;
}

const NON_RETRYABLE_PATTERNS = ['invalid token', 'unauthorized', 'authentication'];
const RETRYABLE_PATTERNS = [
  'timed out',
  'timeout',
  'failed to list models',
  'econnreset',
  'econnrefused',
  'socket hang up',
];

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
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
