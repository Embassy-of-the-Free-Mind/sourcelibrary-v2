import { describe, it, expect } from 'vitest';
import { returnDestination, welcomeSignInUrl } from '../../src/lib/welcome-return';

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

describe('welcomeSignInUrl — the destination survives sign-in too', () => {
  // /welcome requires a session, so a signed-out visitor bounces to sign-in. That
  // bounce used to send a bare callbackUrl=/welcome: the reader signed in and
  // arrived at the homepage, having lost the book they clicked. Same lost-place
  // failure returnDestination fixes, one step earlier in the funnel.
  it('carries the destination through the sign-in round trip', () => {
    const url = welcomeSignInUrl('/book/some-slug');
    expect(url.startsWith('/auth/signin?callbackUrl=')).toBe(true);

    // SignInForm reads callbackUrl with URLSearchParams, so decode the same way
    // rather than asserting on an encoding the reader never sees.
    const callback = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('callbackUrl');
    expect(callback).toBe('/welcome?from=%2Fbook%2Fsome-slug');
    // …and that callback, read back the same way, still points at the book.
    const from = new URLSearchParams(callback!.slice(callback!.indexOf('?') + 1)).get('from');
    expect(returnDestination(from)).toBe('/book/some-slug');
  });

  it('sends a visitor with no destination to a bare /welcome', () => {
    for (const nothing of [null, undefined, '', '/']) {
      const callback = new URLSearchParams(
        welcomeSignInUrl(nothing).split('?')[1]
      ).get('callbackUrl');
      expect(callback).toBe('/welcome');
    }
  });

  it('never embeds an unvalidated destination in the sign-in URL', () => {
    // Validated here rather than passed through: an open redirect is worse in a
    // callbackUrl than in a client-side push, because NextAuth honours it after a
    // successful sign-in, when the reader has every reason to trust the page.
    for (const payload of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '/\\evil.com', '  //evil.com']) {
      const url = welcomeSignInUrl(payload);
      expect(new URLSearchParams(url.split('?')[1]).get('callbackUrl')).toBe('/welcome');
      expect(url).not.toContain('evil.com');
    }
  });

  it('does not build a callback that loops back into the form', () => {
    expect(new URLSearchParams(welcomeSignInUrl('/welcome').split('?')[1]).get('callbackUrl')).toBe('/welcome');
  });
});
