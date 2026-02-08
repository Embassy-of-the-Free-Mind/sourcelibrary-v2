/**
 * Error Classification Utility
 *
 * Classifies caught errors into structured categories for logging.
 * Used by workers and batch endpoints to provide actionable error data.
 */

export type ErrorCategory =
  | 'rate_limit'
  | 'timeout'
  | 'safety_filter'
  | 'invalid_image'
  | 'network'
  | 'api_error'
  | 'no_data'
  | 'unknown';

export function classifyError(error: unknown): { category: ErrorCategory; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  // Gemini API rate limiting
  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('rate limit') || lower.includes('quota')) {
    return { category: 'rate_limit', message };
  }

  // Timeouts
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('deadline_exceeded') || lower.includes('aborted')) {
    return { category: 'timeout', message };
  }

  // Safety filters
  if (lower.includes('safety') || lower.includes('blocked') || lower.includes('harm_category') || lower.includes('finish_reason') && lower.includes('safety')) {
    return { category: 'safety_filter', message };
  }

  // Invalid image data
  if (lower.includes('invalid image') || lower.includes('could not process image') || lower.includes('image too') || lower.includes('unsupported image')) {
    return { category: 'invalid_image', message };
  }

  // Network errors
  if (lower.includes('econnreset') || lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('fetch failed') || lower.includes('network')) {
    return { category: 'network', message };
  }

  // Gemini API errors (status codes, general API errors)
  if (lower.includes('gemini api error') || lower.includes('400') || lower.includes('500') || lower.includes('503') || lower.includes('internal')) {
    return { category: 'api_error', message };
  }

  // No usable data in response
  if (lower.includes('no text') || lower.includes('empty response') || lower.includes('no candidates') || lower.includes('no content')) {
    return { category: 'no_data', message };
  }

  return { category: 'unknown', message };
}
