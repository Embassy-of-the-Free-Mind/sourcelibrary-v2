/**
 * Entity → page attribution (TypeScript twin).
 *
 * Behavioural twin of `scripts/lib/entity-page-match.mjs`, which the batch
 * writers use. Parity is pinned by `tests/unit/entity-page-attribution.test.ts`
 * — change both sides together. The rationale lives in the .mjs header; the
 * short version:
 *
 * Gemini is asked which people/places/concepts appear in a ~50k-char BATCH and
 * returns bare name lists — only `quotes` carry a page number. The old code
 * filled that hole by crediting EVERY page in the batch's range with EVERY
 * entity in it, and those inferred numbers rendered as exact `p. N` citations.
 * Measured on live data, ~22% of claimed pages actually contained the name
 * (#3361). Attribution is now verified against page text, and an entity that
 * matches nothing in its batch falls back to section precision — `pages: []`
 * plus a `page_range` — instead of guessing.
 */

/** Longest trailing inflection we'll trim off a token to form its stem. */
const MAX_TRIM = 2;
/** Shortest stem we'll ever search for. */
const STEM_MIN_LEN = 5;
/**
 * A token must be at least this long to be matched as a SUBSTRING (stemmed).
 * Shorter tokens match only on word boundaries: measured on live data, stemming
 * a 5-char token attributed "James Smart" to a page reading "smartly vibrated"
 * and "Marcus Aurelius Antoninus" to a page naming his mother Aurelia.
 */
const SUBSTRING_MIN_LEN = 7;
/** Tokens shorter than this are ignored entirely (too noisy as needles). */
const MIN_TOKEN_LEN = 4;

/**
 * Honorifics, epithets and role words. These appear in entity names but carry
 * no identity — matching on them attributed "Saint Perpetua" to every page of a
 * liturgical calendar that mentioned any saint.
 */
const GENERIC_NAME_TOKENS = new Set([
  'saint', 'sainte', 'santo', 'santa', 'abba', 'pope', 'papa', 'king', 'queen',
  'emperor', 'empress', 'prince', 'princess', 'duke', 'duchess', 'count',
  'countess', 'earl', 'lord', 'lady', 'father', 'mother', 'brother', 'sister',
  'master', 'doctor', 'rabbi', 'imam', 'sheikh', 'bishop', 'archbishop',
  'cardinal', 'priest', 'monk', 'friar', 'abbot', 'prophet', 'apostle',
  'euangelist', 'evangelist', 'martyr', 'confessor', 'philosopher', 'philosophus',
  'author', 'anonymous', 'unknown', 'elder', 'younger', 'junior', 'senior',
  'blessed', 'venerable', 'sir', 'dame', 'madame', 'monsieur', 'herr',
  'the', 'and', 'von', 'van', 'der', 'den', 'del', 'della', 'di', 'da', 'de',
]);

export type PagePrecision = 'page' | 'section';

export interface EntityMatcher {
  stems: string[];
  patterns: RegExp[];
}

export interface NormalizedPage {
  page_number: number;
  norm: string;
}

export interface PageAttribution {
  pages: number[];
  page_precision: PagePrecision;
  page_range?: { start: number; end: number };
}

interface RawPage {
  page_number: number;
  ocr?: { data?: string | null } | null;
  translation?: { data?: string | null } | null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Fold text into the comparison space: no diacritics, no case, Latin j→i, v→u. */
export function normalizeForMatch(text: string | null | undefined): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/j/g, 'i')
    .replace(/v/g, 'u');
}

/**
 * Needles for one entity name. Only the single most distinctive token counts —
 * matching on every token fires a name's common parts ("Marcus", "Saint") on
 * unrelated text, and one bad needle fabricates a citation. Aliases are
 * deliberately excluded: `entity_aliases` carries generic epithets.
 */
export function buildEntityMatcher(name: string | string[]): EntityMatcher {
  const stems = new Set<string>();
  const patterns: RegExp[] = [];
  const seen = new Set<string>();

  const addPattern = (phrase: string) => {
    if (phrase.length < 2 || seen.has(phrase)) return;
    seen.add(phrase);
    patterns.push(new RegExp(`\\b${escapeRe(phrase)}\\b`));
  };

  const raw = Array.isArray(name) ? name[0] : name;
  if (!raw || typeof raw !== 'string') return { stems: [], patterns: [] };

  const norm = normalizeForMatch(raw);
  const tokens = norm
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= MIN_TOKEN_LEN && !GENERIC_NAME_TOKENS.has(t));

  if (tokens.length === 0) {
    addPattern(norm.replace(/[^a-z0-9]+/g, ' ').trim());
    return { stems: [], patterns };
  }

  let anchor = tokens[0];
  for (const token of tokens) {
    if (token.length >= anchor.length) anchor = token;
  }

  if (anchor.length >= SUBSTRING_MIN_LEN) {
    stems.add(anchor.slice(0, Math.max(STEM_MIN_LEN, anchor.length - MAX_TRIM)));
  } else {
    addPattern(anchor);
  }

  return { stems: [...stems], patterns };
}

/** Does this already-normalized page text name the entity? */
export function pageMatchesEntity(matcher: EntityMatcher, normalizedPageText: string): boolean {
  for (const stem of matcher.stems) {
    if (normalizedPageText.includes(stem)) return true;
  }
  for (const re of matcher.patterns) {
    if (re.test(normalizedPageText)) return true;
  }
  return false;
}

/** Normalize a book's pages once, for reuse across every entity in the book. */
export function buildPageTexts(pages: RawPage[]): NormalizedPage[] {
  return pages.map(p => ({
    page_number: p.page_number,
    norm: normalizeForMatch(`${p.ocr?.data || ''} ${p.translation?.data || ''}`),
  }));
}

/**
 * Attribute one entity to the pages that actually name it, searching only the
 * batch the model read. Callers must not synthesize page numbers from a section
 * range — that reintroduces #3361.
 */
export function attributeEntityPages(
  name: string,
  candidatePages: NormalizedPage[]
): PageAttribution {
  const matcher = buildEntityMatcher(name);
  const matched: number[] = [];
  for (const page of candidatePages) {
    if (pageMatchesEntity(matcher, page.norm)) matched.push(page.page_number);
  }

  if (matched.length > 0) {
    return { pages: matched.sort((a, b) => a - b), page_precision: 'page' };
  }

  const nums = candidatePages.map(p => p.page_number).filter(n => Number.isFinite(n));
  if (nums.length === 0) return { pages: [], page_precision: 'section' };
  return {
    pages: [],
    page_precision: 'section',
    page_range: { start: Math.min(...nums), end: Math.max(...nums) },
  };
}
