/**
 * The current terms version, in a file with no server imports so client code can
 * read it.
 *
 * PRIOR ART: src/lib/partner-embed-download.ts splits the same way, for the same
 * reason. The rule and its record are in src/lib/partner-terms.ts.
 */
export const PARTNER_TERMS_VERSION = '2026-11-04';

/** Absolute: this opens from inside a partner's iframe, whose own routes have no /terms. */
export const PARTNER_TERMS_URL = 'https://sourcelibrary.org/terms#embassy-collection';

/** Where a browser remembers that it agreed, so a reader is asked once per version. */
export const partnerTermsStorageKey = (version: string) => `sl-partner-terms-${version}`;
