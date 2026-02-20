/** Maximum number of ACP reviewer clients running concurrently. */
export const MAX_REVIEWER_CONCURRENCY = 5;

/** Maximum number of batches processed concurrently in multi-batch review. */
export const BATCH_CONCURRENCY = 2;

/** Maximum number of file paths to include in exploration mode prompt. */
export const MAX_EXPLORATION_FILE_PATHS = 1000;

/** Maximum total characters for exploration mode file list in prompt. */
export const MAX_FILE_LIST_CHARS = 80_000;

/** All valid check categories for --checks CLI option. */
export const VALID_CHECK_CATEGORIES = new Set([
  'security',
  'performance',
  'readability',
  'code-quality',
  'best-practices',
]);

/** Maximum characters per batch for codebase review (--batch-size upper bound). */
export const MAX_BATCH_SIZE = 500_000;
