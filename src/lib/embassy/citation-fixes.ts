/**
 * Citation link repair — shared between the Librarian server (which computes
 * fixes after verifying citations) and the chat clients (which apply the same
 * fixes to already-streamed text).
 *
 * A "fix" rewrites every https://sourcelibrary.org/book/<fromSlug> link in a
 * response to point at <toSlug> — the edition we actually hold. Any page
 * suffix (?page=N, /page-number/N, /page/<id>) is deliberately DROPPED in the
 * rewrite: the page number was cited against a book that doesn't exist (or
 * isn't public), so carrying it onto a different edition would deep-link to
 * the wrong page. Landing on the book page is honest; page 427 of the wrong
 * edition is a misquote.
 *
 * A "removal" deletes a fabricated `![alt](url)` image embed. The model is told
 * to embed only image URLs a tool returned this turn; when it invents one
 * anyway the reader gets a broken thumbnail. There is no honest repair for a
 * fabricated image — a different picture is not the picture the caption
 * describes — so we drop the embed and leave the prose.
 *
 * Client-safe: no server imports.
 */

export interface CitationFix {
  fromSlug: string;
  toSlug: string;
  /** Display title of the replacement book (for logging/debugging). */
  toTitle?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The reader host, and ONLY that host.
 *
 * The lookbehind is load-bearing: `images.sourcelibrary.org` ends with
 * `sourcelibrary.org`, so an unanchored pattern reads a perfectly good CDN URL
 * (`images.sourcelibrary.org/artwork/foo.jpg`) as a link to the `/artwork/foo`
 * page and reports it dead.
 *
 * The optional `/es` is the locale prefix: a Spanish conversation cites
 * `sourcelibrary.org/es/book/<slug>`, which is the same book and must be
 * verified (and repaired) exactly like the English link.
 */
export const SITE_HOST_PATTERN = '(?<![\\w.-])sourcelibrary\\.org(?:\\/es)?';

/** Book links in a response: `/book/<slug>` plus any page suffix. */
export function findCitedBookLinks(text: string): Array<{ slug: string; page?: number }> {
  const pattern = new RegExp(
    `${SITE_HOST_PATTERN}\\/book\\/([a-z0-9-]+)(?:(?:\\/page-number\\/|\\/page\\/|\\?page=)(\\d+))?`,
    'g',
  );
  const out: Array<{ slug: string; page?: number }> = [];
  for (const m of text.matchAll(pattern)) {
    out.push(m[2] ? { slug: m[1], page: Number(m[2]) } : { slug: m[1] });
  }
  return out;
}

/** `/artwork/<slug>` links in a response. */
export function findCitedArtworkSlugs(text: string): string[] {
  const pattern = new RegExp(`${SITE_HOST_PATTERN}\\/artwork\\/([a-z0-9-]+)`, 'g');
  return [...text.matchAll(pattern)].map(m => m[1]);
}

/**
 * Collection links, split by route shape. `/collections/<slug>` (plural) is the
 * real route; `/collection/<slug>` (singular) is not a route at all and always
 * 404s, so it needs no lookup.
 */
export function findCitedCollectionSlugs(text: string): { plural: string[]; singular: string[] } {
  const plural = [...text.matchAll(new RegExp(`${SITE_HOST_PATTERN}\\/collections\\/([a-z0-9-]+)`, 'g'))].map(m => m[1]);
  const singular = [...text.matchAll(new RegExp(`${SITE_HOST_PATTERN}\\/collection\\/([a-z0-9-]+)`, 'g'))].map(m => m[1]);
  return { plural, singular };
}

/**
 * Apply citation fixes to a response text. Matches the base book URL plus any
 * page suffix, bounded so a slug that prefixes another slug can't match it
 * (e.g. a fix for `corpus-hermeticum` must not touch
 * `corpus-hermeticum-with-pneumatica-...`).
 */
export function applyCitationFixes(text: string, fixes: CitationFix[]): string {
  let out = text;
  for (const fix of fixes) {
    if (!fix?.fromSlug || !fix?.toSlug || fix.fromSlug === fix.toSlug) continue;
    // `$1` keeps the `/es` locale prefix (if any) on the repaired link.
    const pattern = new RegExp(
      `https://sourcelibrary\\.org(/es)?/book/${escapeRegex(fix.fromSlug)}(?![a-z0-9-])` +
      `(?:\\?page=\\d+|/page-number/\\d+|/page/[A-Za-z0-9-]+)?`,
      'g',
    );
    out = out.replace(pattern, (_m, prefix: string | undefined) => `https://sourcelibrary.org${prefix ?? ''}/book/${fix.toSlug}`);
  }
  return out;
}

/**
 * Strip `![alt](url)` embeds whose URL the model invented.
 *
 * Only the embed is removed — a following italic caption line is left alone,
 * because it usually carries real book/author citations that survive their
 * image. A removed embed that sat on its own line takes its blank line with it
 * so the prose doesn't gain a gap.
 */
/** Every `![alt](url)` embed URL in a response, in order of appearance. */
export function findEmbeddedImageUrls(text: string): string[] {
  const urls: string[] = [];
  const pattern = /!\[[^\]]*\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)/g;
  let m;
  while ((m = pattern.exec(text)) !== null) urls.push(m[1]);
  return urls;
}

export function applyImageRemovals(text: string, removeUrls: string[]): string {
  let out = text;
  for (const url of removeUrls) {
    if (!url) continue;
    const embed = `!\\[[^\\]]*\\]\\(\\s*${escapeRegex(url)}(?:\\s+"[^"]*")?\\s*\\)`;
    // Own-line embed: take the line and one trailing newline with it.
    out = out.replace(new RegExp(`^[ \\t]*${embed}[ \\t]*\\r?\\n`, 'gm'), '');
    // Any survivor (inline, or last line with no trailing newline).
    out = out.replace(new RegExp(embed, 'g'), '');
  }
  return out;
}
