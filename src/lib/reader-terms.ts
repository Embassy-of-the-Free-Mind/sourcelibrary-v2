/**
 * The agreement asked of a browser that opens a deep book page cold (#8286).
 *
 * PRIOR ART: src/lib/partner-terms.ts asks before a download from a protected
 * partner's book, on the server, per request, with no cookie, because its asker
 * can sit in a cross-site iframe. This one is asked at the Cloudflare edge in
 * front of cached HTML, so the edge can only remember an answer through a cookie.
 * The same stance carries over: THIS RECORDS AGREEMENT. A script can post the form
 * or forge the cookie. What it buys is a dated statement, and a client that does
 * neither never loads the page.
 *
 * The rule itself lives in Cloudflare; scripts/maintenance/reader-terms-rule.mjs
 * holds its expression and page. It reads the cookie name below, so renaming it
 * means changing the rule in the same release.
 *
 * A shortlink carries no pass. One did for its first hours, so that a citation
 * opened from a PDF or a chat app would not stop at this form, and shortlink visits
 * went from about 350 a day to about 50 a minute: 33,876 in 11 hours from a pool of
 * single-use addresses. A cited reader now ticks the box once, like anyone else.
 */

/** A change of substance to the #reading-terms section of /terms needs a new version. */
export const READER_TERMS_VERSION = '2026-11-06';

/** Set when a browser agrees. The rule tests that it exists, not its value. */
export const READER_TERMS_COOKIE = 'sl_terms';

export const READER_TERMS_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Where a visitor goes when the page they came from cannot be read. */
export const READER_TERMS_FALLBACK_PATH = '/library';

const BOOK_PAGE_PATH = /^(\/(es|la|nl|zh))?\/book\/[^/?#\\]+\/page\/[^?#\\]+(\?[^#\\]*)?$/;

/**
 * The page to go back to: a same-site deep book page, or the fallback. Only those
 * paths can pass, so the form cannot be used to redirect someone off the site.
 */
export function readerTermsReturnPath(candidate: string | null | undefined): string {
  if (!candidate) return READER_TERMS_FALLBACK_PATH;
  return BOOK_PAGE_PATH.test(candidate) ? candidate : READER_TERMS_FALLBACK_PATH;
}

/** The path and query of a same-origin Referer, for a browser that ran no JavaScript. */
export function pathFromSameOriginUrl(url: string | null, origin: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.origin === origin ? `${parsed.pathname}${parsed.search}` : null;
  } catch {
    return null;
  }
}
