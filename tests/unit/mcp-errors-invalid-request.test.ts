import { describe, it, expect } from 'vitest';
import { classifyApiError } from '@/lib/mcp-errors';

/**
 * A deterministic 4xx must not be reported as transient.
 *
 * Reported by an MCP client that lost two feedback submissions to this (#3653):
 * a "Message too long" 400 was classified `transient`, with recovery "Retry
 * once. If it fails again, treat it as unavailable and say so plainly."
 *
 *   "A length rejection is deterministic — the same payload will fail
 *    identically every time. Labelling it transient and advising retry actively
 *    misleads an automated caller: the correct response is to shorten and
 *    resubmit. An agent following the stated recovery burns a call and then, per
 *    the same advice, may give up entirely on a request that would have
 *    succeeded at 2000 characters. I only recovered because I ignored the
 *    recovery guidance and shortened instead."
 *
 * Note the reporter's third claim — that the real ceiling is lower than the
 * documented 5000 — did NOT hold. A 4,956-character submission is stored, so the
 * limit is exactly as advertised and the rejected messages were simply over it.
 * What was wrong is the classification and the silence about the limit.
 */

const tooLong = 'API 400: {"error":"Message too long: 5211 characters received, maximum 5000"}';

describe('deterministic validation failures', () => {
  it('classify as invalid_request, not transient', () => {
    expect(classifyApiError(new Error(tooLong)).error).toBe('invalid_request');
  });

  it('tell the caller to shorten rather than retry', () => {
    const r = classifyApiError(new Error(tooLong));
    expect(r.recovery).toMatch(/shorten/i);
    expect(r.recovery).toMatch(/do not retry/i);
  });

  it('pass the limit through, since that is what the caller must aim at', () => {
    // The route names its own maximum. Replacing that sentence with a generic
    // one would put the caller back to binary-searching the ceiling by trial,
    // which is the complaint.
    const r = classifyApiError(new Error(tooLong));
    expect(r.message).toContain('maximum 5000');
    expect(r.message).toContain('5211');
    expect(r.message).not.toContain('API 400');
  });

  it('cover validation failures other than length', () => {
    const r = classifyApiError(new Error('API 400: {"error":"Message is required"}'));
    expect(r.error).toBe('invalid_request');
    expect(r.recovery).toMatch(/do not retry/i);
  });

  it('fall back to the raw string when the body is not JSON', () => {
    const r = classifyApiError(new Error('API 400: plain text complaint'));
    expect(r.error).toBe('invalid_request');
    expect(r.message).toContain('plain text complaint');
  });
});

describe('the new branch does not swallow the existing ones', () => {
  it('leaves a real outage transient', () => {
    const r = classifyApiError(new Error('API 502: upstream unavailable'));
    expect(r.error).toBe('transient');
    expect(r.recovery).toMatch(/retry once/i);
  });

  it('leaves the more specific 4xx cases alone', () => {
    expect(classifyApiError(new Error('API 404: nope')).error).toBe('not_found');
    expect(classifyApiError(new Error('API 401: nope')).error).toBe('auth_required');
    expect(classifyApiError(new Error('API 429: slow down')).error).toBe('rate_limited');
    expect(classifyApiError(new Error('API 400: {"error":"No translation available for this page"}')).error)
      .toBe('no_translation');
    expect(classifyApiError(new Error('API 413: too large')).error).toBe('too_large');
  });
});
