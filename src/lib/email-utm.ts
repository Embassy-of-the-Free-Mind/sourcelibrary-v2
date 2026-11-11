/**
 * Campaign tags for links in outgoing email, and the reader side that records them.
 *
 * PRIOR ART: none — searched src/ and scripts/email/ for "utm"; nothing tagged or read campaign parameters.
 *
 * Why: mail apps strip the referrer, so a click from a newsletter lands in the
 * analytics as "direct" and cannot be told apart from someone typing the URL
 * (the Solve et Coagula letter, 2026-11-10, doubled traffic for an hour and all
 * of it read "direct"). Tagging our own links with utm_* parameters, and having
 * /api/track store them, makes each letter's clicks countable.
 *
 * Kept free of imports and non-erasable TypeScript so scripts/email/*.mjs can
 * import it directly under Node's type stripping.
 */

const OWN_HOST = /^https?:\/\/(?:www\.)?sourcelibrary\.org(?=[/?#"']|$)/i;

/** Turn a subject or name into a short campaign id: "New Podcast!" -> "new-podcast". */
export function campaignSlug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Add utm_source=newsletter, utm_medium=email, utm_campaign=<campaign> to every
 * href pointing at sourcelibrary.org. Other hosts (YouTube, archives) are left
 * alone, as are links that already carry a utm_ parameter and Resend's
 * unsubscribe merge tag.
 */
export function tagEmailLinks(html: string, campaign: string): string {
  const slug = campaignSlug(campaign);
  if (!slug) return html;
  return html.replace(/href=(["'])(.*?)\1/gi, (whole: string, quote: string, url: string) => {
    if (!OWN_HOST.test(url) || /[?&]utm_/i.test(url)) return whole;
    const hashAt = url.indexOf('#');
    let base = hashAt === -1 ? url : url.slice(0, hashAt);
    if (/^https?:\/\/[^/?]+$/i.test(base)) base += '/';
    const hash = hashAt === -1 ? '' : url.slice(hashAt);
    const sep = base.includes('?') ? '&amp;' : '?';
    const tags = `utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=${slug}`;
    return `href=${quote}${base}${sep}${tags}${hash}${quote}`;
  });
}

export type UtmTags = { source?: string; medium?: string; campaign?: string; content?: string };

const UTM_KEYS = ['source', 'medium', 'campaign', 'content'] as const;

/**
 * Read utm_* tags from a query string, keeping only short, plain values.
 * Returns null when there are none, so rows without a campaign stay unchanged.
 */
export function readUtm(search: string | null | undefined): UtmTags | null {
  if (!search) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const out: UtmTags = {};
  for (const key of UTM_KEYS) {
    const value = params.get(`utm_${key}`);
    if (value && /^[\w.\-]{1,60}$/.test(value)) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}
