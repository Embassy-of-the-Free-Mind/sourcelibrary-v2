import { describe, it, expect } from 'vitest';

/**
 * Mirrors skipReason() in scripts/maintenance/notify-addressed-feedback.mjs.
 * Kept in step by hand — the script is .mjs and cannot be imported here.
 *
 * Both directions of this filter are costly. Too loose and we hard-bounce mail
 * from a domain that also has a newsletter to deliver; too tight and a reader
 * who reported a real bug silently never hears that we fixed it.
 */
const RESERVED_DOMAIN = /(^|\.)(example\.(com|net|org)|test|invalid|localhost)$/i;
const SELF = new Set(['dereklomas@gmail.com', 'derek@sourcelibrary.org', 'julikalomas@gmail.com']);
const domainOf = (e: string) => String(e || '').split('@')[1]?.trim().toLowerCase() || '';

function skipReason(email: string, includeSelf = false): string | null {
  const e = String(email || '').trim().toLowerCase();
  if (!e.includes('@')) return 'not an address';
  if (RESERVED_DOMAIN.test(domainOf(e))) return 'reserved domain — would hard-bounce';
  if (!includeSelf && SELF.has(e)) return 'ours';
  return null;
}

describe('who the feedback notifier will write to', () => {
  it('sends to an ordinary reader', () => {
    expect(skipReason('pepejuarez33@gmail.com')).toBeNull();
    expect(skipReason('jbouman@efm.amsterdam')).toBeNull();
  });

  it('refuses reserved domains that cannot receive mail', () => {
    // Both of these were really in the queue: an MCP test harness and a doc example.
    expect(skipReason('mcp-test-harness-noreply@example.invalid')).toMatch(/hard-bounce/);
    expect(skipReason('sarah.chen@example.com')).toMatch(/hard-bounce/);
    expect(skipReason('x@something.test')).toMatch(/hard-bounce/);
  });

  it('does not mistake a real domain for a reserved one', () => {
    // The anchored suffix matters: these are legitimate and must not be dropped.
    expect(skipReason('someone@example.com.mx')).toBeNull();
    expect(skipReason('someone@testing.org')).toBeNull();
    expect(skipReason('someone@invalidate.io')).toBeNull();
    expect(skipReason('someone@myexample.com')).toBeNull();
  });

  it('skips our own addresses by default, and includes them on request', () => {
    expect(skipReason('dereklomas@gmail.com')).toBe('ours');
    expect(skipReason('DerekLomas@Gmail.com')).toBe('ours');
    expect(skipReason('dereklomas@gmail.com', true)).toBeNull();
  });

  it('rejects a row whose email is not an address', () => {
    expect(skipReason('')).toBe('not an address');
    expect(skipReason('nobody')).toBe('not an address');
  });
});
