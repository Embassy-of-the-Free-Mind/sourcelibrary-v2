/**
 * Shared retry utility for MongoDB writes in Lambda workers.
 *
 * Used by AI workers and the write-processor to retry expensive operations
 * that must not be lost (e.g., saving Gemini results after tokens are spent).
 */

/**
 * Retry a MongoDB operation with exponential backoff.
 *
 * @param fn - The async operation to retry
 * @param label - Human-readable label for logging
 * @param maxRetries - Maximum number of attempts (default: 3)
 * @param logPrefix - Log prefix for context (default: '[DB]')
 */
export async function retryDbWrite<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
  logPrefix = '[DB]'
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      console.warn(`${logPrefix} ${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, (err as Error).message);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}
