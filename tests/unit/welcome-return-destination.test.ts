import { describe, it, expect } from 'vitest';
import { returnDestination } from '../../src/lib/welcome-return';

// WelcomeGate records where the reader was headed as ?from=, and the form used to
// discard it and push everyone to '/'. For the ~3,850 existing readers now meeting
// the gate mid-journey that means: click a link to a book, get pulled to /welcome,
// land on the homepage with the book lost.
//
// The param is user-controlled, so the interesting half of these tests is the
// rejection set — a naive `router.push(from)` is a textbook open redirect.

describe('returnDestination — sends the reader back where they were going', () => {
  it('restores a real destination', () => {
    expect(returnDestination('/book/some-slug')).toBe('/book/some-slug');
    expect(returnDestination('/book/some-slug/page/abc123')).toBe('/book/some-slug/page/abc123');
    expect(returnDestination('/collections/alchemy')).toBe('/collections/alchemy');
  });

  it('decodes the value the gate encoded', () => {
    // WelcomeGate builds the param with encodeURIComponent(pathname).
    expect(returnDestination(encodeURIComponent('/gallery/image/x?q=1'))).toBe('/gallery/image/x?q=1');
  });

  it('falls back to the homepage when there is nothing to return to', () => {
    expect(returnDestination(null)).toBe('/');
    expect(returnDestination(undefined)).toBe('/');
    expect(returnDestination('')).toBe('/');
  });
});

describe('returnDestination — open-redirect rejections', () => {
  it('rejects protocol-relative URLs', () => {
    // The classic payload: browsers resolve //evil.com against the current scheme.
    expect(returnDestination('//evil.com')).toBe('/');
    expect(returnDestination('//evil.com/path')).toBe('/');
    expect(returnDestination(encodeURIComponent('//evil.com'))).toBe('/');
  });

  it('rejects the backslash variant of a protocol-relative URL', () => {
    // Several browsers normalise backslashes to forward slashes when resolving.
    expect(returnDestination('/\\evil.com')).toBe('/');
    expect(returnDestination('/\\\\evil.com')).toBe('/');
  });

  it('rejects absolute URLs and non-http schemes', () => {
    expect(returnDestination('https://evil.com')).toBe('/');
    expect(returnDestination('http://evil.com')).toBe('/');
    expect(returnDestination('javascript:alert(1)')).toBe('/');
    expect(returnDestination('mailto:someone@example.com')).toBe('/');
    expect(returnDestination(encodeURIComponent('javascript:alert(1)'))).toBe('/');
  });

  it('rejects a destination that would bounce back into the form', () => {
    // An infinite loop: save → /welcome → save → /welcome …
    expect(returnDestination('/welcome')).toBe('/');
    expect(returnDestination('/welcome?from=%2F')).toBe('/');
    expect(returnDestination('/welcome/anything')).toBe('/');
  });

  it('survives malformed percent-encoding instead of throwing', () => {
    // decodeURIComponent('%') throws URIError. An analytics-grade nicety would be
    // to ignore it; here it would break the reader's exit from the form.
    expect(() => returnDestination('%')).not.toThrow();
    expect(returnDestination('%')).toBe('/');
    expect(returnDestination('%E0%A4%A')).toBe('/');
  });

  it('does not treat leading whitespace as a way past the checks', () => {
    expect(returnDestination('  //evil.com')).toBe('/');
    expect(returnDestination('  https://evil.com')).toBe('/');
  });
});
