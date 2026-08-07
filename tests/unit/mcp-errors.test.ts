import { describe, it, expect } from 'vitest';
import { classifyApiError } from '@/lib/mcp-errors';

// Each input below is a REAL error string produced by the apiGet helper, taken
// from live calls — not invented shapes.
describe('classifyApiError', () => {
  // The single most misread response in the feedback (#3083, 10 submissions):
  // the anon gate answers with this, the client reads a non-deterministic
  // failure, falls back to web search, and tells the user the text could not be
  // retrieved — a false claim about the corpus caused by a temporary limit.
  it('names the anon rate-gate as temporary, and says not to disclaim the corpus', () => {
    const r = classifyApiError(new Error('API 200: No approval received'));
    expect(r.error).toBe('rate_limited');
    expect(r.retry_after).toBeGreaterThan(0);
    expect(r.recovery).toMatch(/do not tell the user/i);
  });

  it('treats a 429 the same way', () => {
    expect(classifyApiError(new Error('API 429: Too Many Requests')).error).toBe('rate_limited');
  });

  // Observed live 2026-08-06 on an OCR-only book, page 25.
  it('distinguishes "no translation yet" from "not found"', () => {
    const r = classifyApiError(new Error('API 404: {"error":"No translation available for this page","page_number":25}'));
    expect(r.error).toBe('no_translation');
    expect(r.has_original).toBe(true);
    expect(r.recovery).toMatch(/get_book_text/);
    // The distinction that matters: the page is NOT missing, and a caller told
    // "not_found" would wrongly report the corpus lacks it.
    expect(r.error).not.toBe('not_found');
  });

  it('still reports a genuine 404 as not_found', () => {
    expect(classifyApiError(new Error('API 404: Book not found')).error).toBe('not_found');
  });

  it('marks auth failures as not worth retrying', () => {
    const r = classifyApiError(new Error('API 401: Unauthorized'));
    expect(r.error).toBe('auth_required');
    expect(r.recovery).toMatch(/will not help/i);
  });

  it('falls back to transient with the original message preserved', () => {
    const r = classifyApiError(new Error('API 502: upstream exploded'));
    expect(r.error).toBe('transient');
    expect(r.message).toContain('upstream exploded');
  });

  it('never returns a payload without a recovery instruction', () => {
    for (const e of ['API 429: x', 'API 401: x', 'API 404: x', 'API 502: x', 'weird', '']) {
      const r = classifyApiError(new Error(e));
      expect(r.recovery, e).toBeTruthy();
      expect(r.message, e).toBeTruthy();
    }
  });

  it('handles a non-Error throw', () => {
    expect(classifyApiError('just a string').error).toBe('transient');
    expect(classifyApiError(null).error).toBe('transient');
  });
});
