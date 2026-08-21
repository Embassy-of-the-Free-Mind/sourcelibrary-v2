/**
 * Entity → page attribution.
 *
 * The index extractor (enrich-worker Phase 6, batch-generate-indexes) asks
 * Gemini "who/what appears in these pages" over a ~50k-char BATCH and gets back
 * bare name lists — no page numbers. Quotes carry a `page`; people/places/
 * concepts never did. The old code filled that hole by crediting EVERY page in
 * the batch's range with EVERY entity in the batch, and `/encyclopedia/[name]`
 * rendered those inferred numbers as exact `p. N` citations. Measured on 30
 * sampled entity-book pairs, only ~22% of claimed pages actually contained the
 * name — i.e. most page citations on that surface were fabricated (#3361).
 *
 * So: we verify. The batch tells us WHICH entities are in a section; the page
 * text tells us WHERE. An entity is attributed to a page only if that page's
 * OCR or translation text actually names it. When no page in the batch matches
 * (divergent spelling, entity named only in paraphrase, OCR too rough), we fall
 * back to SECTION precision — `pages: []` plus a `page_range` — rather than
 * guessing. A coarse true claim beats a precise false one.
 *
 * Matching is deliberately tolerant of how early-modern print actually reads:
 * diacritics are stripped, Latin j/v are folded to i/u (Iohannes/Johannes,
 * Vrbs/Urbs), and a token matches on its stem so case endings inflect freely
 * (Matthiolus / Matthioli / Matthiolum). Tolerance costs recall in the safe
 * direction only — a miss becomes section precision, never a false page cite.
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

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fold text into the space where matches are compared: no diacritics, no case,
 * Latin j→i and v→u. Applied identically to needle and haystack.
 */
export function normalizeForMatch(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/j/g, 'i')
    .replace(/v/g, 'u');
}

/**
 * Build the needle set for an entity name. Returns { stems, patterns } — a page
 * matches if ANY needle hits.
 *
 * Only the single most distinctive token of the name becomes a needle. Matching
 * on every token is what produced the false positives above: a name's common
 * parts ("Marcus", "James", "Saint") fire on unrelated text, and one bad needle
 * is enough to fabricate a citation. The distinctive token is the longest one
 * after stoplisting, breaking ties toward the last — Western surnames trail, and
 * single-name figures have only one token anyway.
 *
 * Aliases are deliberately NOT used. The `entity_aliases` table carries generic
 * epithets ("the philosopher", "Confessor") that match half the corpus. Losing
 * an alias spelling costs recall, which degrades to section precision — safe.
 */
export function buildEntityMatcher(name) {
  const stems = new Set();
  const patterns = [];
  const seenPatterns = new Set();

  const addPattern = (phrase) => {
    if (phrase.length < 2 || seenPatterns.has(phrase)) return;
    seenPatterns.add(phrase);
    patterns.push(new RegExp(`\\b${escapeRe(phrase)}\\b`));
  };

  const raw = Array.isArray(name) ? name[0] : name;
  if (!raw || typeof raw !== 'string') return { stems: [], patterns: [] };

  const norm = normalizeForMatch(raw);
  const tokens = norm
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= MIN_TOKEN_LEN && !GENERIC_NAME_TOKENS.has(t));

  if (tokens.length === 0) {
    // Nothing distinctive to stem ("Job", "Ur", "Li Bo", "The Master") — only an
    // exact whole-word hit on the full name counts.
    addPattern(norm.replace(/[^a-z0-9]+/g, ' ').trim());
    return { stems: [], patterns };
  }

  let anchor = tokens[0];
  for (const token of tokens) {
    if (token.length >= anchor.length) anchor = token;
  }

  if (anchor.length >= SUBSTRING_MIN_LEN) {
    // Long enough that a prefix stem stays distinctive, so Latin case endings
    // don't hide a real mention (Matthiolus / Matthioli / Matthiolum).
    stems.add(anchor.slice(0, Math.max(STEM_MIN_LEN, anchor.length - MAX_TRIM)));
  } else {
    addPattern(anchor);
  }

  return { stems: [...stems], patterns };
}

/** Does this already-normalized page text name the entity? */
export function pageMatchesEntity(matcher, normalizedPageText) {
  for (const stem of matcher.stems) {
    if (normalizedPageText.includes(stem)) return true;
  }
  for (const re of matcher.patterns) {
    if (re.test(normalizedPageText)) return true;
  }
  return false;
}

/**
 * Normalize a book's pages once, for reuse across every entity in the book.
 * Both OCR and translation count as evidence: a Latin page names "Matthiolus"
 * in the OCR, an English-only reader finds him in the translation.
 */
export function buildPageTexts(pages) {
  return pages.map(p => ({
    page_number: p.page_number,
    norm: normalizeForMatch(`${p.ocr?.data || ''} ${p.translation?.data || ''}`),
  }));
}

/**
 * Attribute one entity to the pages that actually name it.
 *
 * `candidatePages` is the batch's own page set — the entity is known to be
 * somewhere in there, so we never search the whole book and never invent a
 * location outside the section Gemini actually read.
 *
 * Returns page precision with verified page numbers, or section precision with
 * the range and no page numbers at all. Callers must not synthesize pages from
 * a section range — that reintroduces #3361.
 */
export function attributeEntityPages(name, candidatePages) {
  const matcher = buildEntityMatcher(name);
  const matched = [];
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

/**
 * Collapse an entity's per-book entries into the shape the read path trusts:
 * one entry per book_id (the writer used to `$addToSet` whole subdocuments, so
 * a re-run appended a second entry for the same book — Matthiolus carried 162
 * entries for 117 distinct books, which is why the hero count and the "Appears
 * in N Books" heading disagreed).
 */
export function dedupeEntityBooks(books) {
  const byBook = new Map();
  for (const entry of books || []) {
    if (!entry?.book_id) continue;
    const prev = byBook.get(entry.book_id);
    if (!prev) {
      byBook.set(entry.book_id, { ...entry, pages: [...(entry.pages || [])] });
      continue;
    }
    // Merge: verified pages win over a section range, and page precision is
    // sticky once any entry has it.
    const pages = [...new Set([...(prev.pages || []), ...(entry.pages || [])])].sort((a, b) => a - b);
    const precision = prev.page_precision === 'page' || entry.page_precision === 'page' || pages.length > 0
      ? 'page'
      : 'section';
    const merged = { ...prev, ...entry, pages, page_precision: precision };
    if (precision === 'page') delete merged.page_range;
    else merged.page_range = prev.page_range || entry.page_range;
    byBook.set(entry.book_id, merged);
  }
  return [...byBook.values()];
}

/**
 * Canonical counters for an entity. `total_mentions` counts VERIFIED page
 * references only — it used to be the sum of smeared page-array lengths, which
 * is how Matthiolus came to advertise "10,700 total mentions".
 */
export function entityCounters(books) {
  const deduped = dedupeEntityBooks(books);
  return {
    book_count: deduped.length,
    total_mentions: deduped.reduce((sum, b) => sum + (b.pages?.length || 0), 0),
  };
}
