/**
 * Navigational match (#5945): a short query is often the NAME of a place on
 * the site — "timeline", "check pages", "Drebbel collection", "Huygens" — and
 * the visitor wants the page, not passages about it.
 *
 * PRIOR ART: src/lib/known-entities.ts — matchKnownEntity() is exact-match
 * only, client-side, over collections, partners and site-features.json; it
 * cannot see a static page, an author, or "Drebbel collection" for a
 * collection named "Cornelis Drebbel". semanticSiteSearch() (semantic-search.ts)
 * ranks by meaning and misses one-word names. This is the lexical lane between
 * them, over the names scripts/workers/embed-site-pages.mjs stores.
 *
 * Pure (no store access): the lookup that feeds it is navSiteSearch() in
 * src/lib/semantic-search.ts, beside the semantic site lane.
 *
 * The rule, in one place so it can be tested:
 *   - A page matches when ONE of its names contains every query token.
 *   - Its score is the share of that name the query covers: "huygens" covers
 *     half of "Christiaan Huygens" (0.5) and all of the alias "timeline" (1).
 *   - Below NAV_MIN_COVERAGE the query is a word IN a name, not the name
 *     ("quality" in "How We Measure OCR Quality"), and the page is not shown.
 *   - A type word ("collection", "author", "essay", "page") may be dropped
 *     from the query, and then only pages of that type are considered.
 *   - A page named exactly (coverage 1) silences partial matches: "kabbalah"
 *     is the Kabbalah collection, not also "Jewish Kabbalah".
 */
import { navTokens } from '../../../scripts/lib/site-nav-names.mjs';

export type NavPageType = 'blog' | 'collection' | 'page' | 'feature' | 'author';

export interface NavCandidate {
  url: string;
  page_type: NavPageType;
  title: string;
  /** What the page is called: title, URL words, aliases. */
  names: string[];
  /** Tie-break among equal matches; never shown. */
  weight?: number;
  text?: string;
}

export interface NavMatch<T extends NavCandidate = NavCandidate> {
  candidate: T;
  /** Share of the matched name the query covers, 0–1. */
  coverage: number;
}

export const NAV_MIN_COVERAGE = 0.5;
/** A longer query is a question or a phrase, not a name. */
const NAV_MAX_TOKENS = 6;

/** Folded type words → the page types they ask for. `null` = any type ("page"). */
const TYPE_WORDS: Record<string, NavPageType[] | null> = {
  collection: ['collection'],
  author: ['author'],
  blog: ['blog'],
  essay: ['blog'],
  post: ['blog'],
  article: ['blog'],
  tool: ['feature', 'page'],
  page: null,
};

/** Equal matches: a page or tool first, then a collection, an author, an essay. */
const TYPE_ORDER: Record<NavPageType, number> = { page: 0, feature: 0, collection: 1, author: 2, blog: 3 };

export interface NavQuery {
  /** Every folded token of the query. */
  tokens: string[];
  /** The query without its type words; empty when nothing was dropped or nothing would be left. */
  bare: string[];
  /** Page types the dropped type words ask for; null = any. */
  types: NavPageType[] | null;
}

export function parseNavQuery(query: string): NavQuery | null {
  const tokens: string[] = navTokens(query.replace(/^"(.*)"$/, '$1'));
  if (tokens.length === 0 || tokens.length > NAV_MAX_TOKENS) return null;
  const bare = tokens.filter((t) => !(t in TYPE_WORDS));
  if (bare.length === 0 || bare.length === tokens.length) return { tokens, bare: [], types: null };
  const asked = tokens.filter((t) => t in TYPE_WORDS).map((t) => TYPE_WORDS[t]);
  const specific = asked.filter((a): a is NavPageType[] => a !== null).flat();
  return { tokens, bare, types: specific.length > 0 ? [...new Set(specific)] : null };
}

function coverage(queryTokens: string[], nameTokens: string[]): number {
  if (nameTokens.length === 0 || !queryTokens.every((t) => nameTokens.includes(t))) return 0;
  return queryTokens.length / nameTokens.length;
}

/**
 * Rank candidates for a query. Pure: the caller supplies the candidates (from
 * `match_site_pages_by_name`, or the collections list).
 */
export function rankNavMatches<T extends NavCandidate>(query: string, candidates: T[], limit = 3): NavMatch<T>[] {
  const q = parseNavQuery(query);
  if (!q) return [];
  const matches: NavMatch<T>[] = [];
  for (const candidate of candidates) {
    const typeAllowed = q.bare.length > 0 && (q.types === null || q.types.includes(candidate.page_type));
    let best = 0;
    for (const name of candidate.names) {
      const tokens: string[] = navTokens(name);
      best = Math.max(best, coverage(q.tokens, tokens), typeAllowed ? coverage(q.bare, tokens) : 0);
    }
    if (best >= NAV_MIN_COVERAGE) matches.push({ candidate, coverage: best });
  }
  const depth = (url: string) => url.split('/').length;
  const exact = matches.filter((m) => m.coverage === 1);
  return (exact.length > 0 ? exact : matches)
    .sort((a, b) =>
      b.coverage - a.coverage
      || TYPE_ORDER[a.candidate.page_type] - TYPE_ORDER[b.candidate.page_type]
      || depth(a.candidate.url) - depth(b.candidate.url)
      || (b.candidate.weight || 0) - (a.candidate.weight || 0)
      || a.candidate.url.localeCompare(b.candidate.url))
    .slice(0, limit);
}
