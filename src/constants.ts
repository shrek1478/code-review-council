/**
 * Maximum number of ACP reviewer clients running concurrently per batch.
 * Combined with BATCH_CONCURRENCY, the maximum simultaneous clients
 * is MAX_REVIEWER_CONCURRENCY × BATCH_CONCURRENCY (e.g. 5×2 = 10).
 */
export const MAX_REVIEWER_CONCURRENCY = 5;

/** Maximum number of batches processed concurrently in multi-batch review. */
export const BATCH_CONCURRENCY = 2;

/** Maximum number of file paths to include in exploration mode prompt. */
export const MAX_EXPLORATION_FILE_PATHS = 1000;

/** Maximum total characters for exploration mode file list in prompt. */
export const MAX_FILE_LIST_CHARS = 80_000;

/**
 * Valid check categories for --checks CLI option (user-facing input categories).
 * Note: decision-maker.service.ts has its own VALID_CATEGORIES which includes 'other'
 * as an AI output classification category — the two sets serve different purposes.
 */
export const VALID_CHECK_CATEGORIES = new Set([
  'security',
  'performance',
  'readability',
  'code-quality',
  'best-practices',
]);

/** Maximum characters per batch for codebase review (--batch-size upper bound). */
export const MAX_BATCH_SIZE = 500_000;
