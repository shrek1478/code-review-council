export interface RetryOptions {
  maxRetries: number;
  label: string;
  logger: { warn(message: string): void };
  onRetry?: () => Promise<void>;
}

const NON_RETRYABLE_CODES = new Set([
  'ERR_INVALID_TOKEN',
  'ERR_UNAUTHORIZED',
  'ERR_AUTHENTICATION',
]);
const RETRYABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
]);

const NON_RETRYABLE_PATTERNS = [
  'invalid token',
  'unauthorized',
  'authentication',
];
const RETRYABLE_PATTERNS = [
  'timed out',
  'timeout',
  'empty response',
  'failed to list models',
  'econnreset',
  'econnrefused',
  'socket hang up',
];

/** Mask potential tokens/secrets in error messages. */
export function sanitizeErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.replace(/[A-Za-z0-9+/=_-]{32,}/g, '[REDACTED]').replace(
    // Common secret prefixes (even if shorter than 32 chars)
    /(?:sk-|ghp_|gho_|ghu_|ghs_|ghr_|glpat-|xox[bsrap]-)[A-Za-z0-9+/=_-]+/gi,
    '[REDACTED]',
  );
}

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
        // Add jitter (0.75x–1.25x) to avoid synchronized retry storms across reviewers
        const delay = Math.round(
          2000 * Math.pow(2, attempt) * (0.75 + Math.random() * 0.5),
        );
        logger.warn(
          `${label} attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        if (onRetry) {
          try {
            await onRetry();
          } catch (retryError) {
            logger.warn(
              `${label} onRetry callback failed, aborting retries: ${retryError instanceof Error ? retryError.message : retryError}`,
            );
            throw retryError;
          }
        }
        continue;
      }
      throw error;
    }
  }
  throw new Error(`${label} exhausted all retries`);
}
