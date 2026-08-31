/**
 * Identity fields — .mjs twin of `src/lib/identity-fields.ts` (+ the parts of
 * `src/lib/dedup.ts` and `src/lib/edition-key.ts` it composes).
 *
 * Exists because `scripts/workers/identity-worker.mjs` runs under plain node
 * on Hetzner and cannot import TypeScript. Twin convention as in r2-key /
 * ngram-normalize / cover-scoring: the TS side is canonical, this file is a
 * port, and `tests/unit/identity-fields-parity.test.ts` fails CI if the two
 * ever disagree on the fixture corpus. Change BOTH sides or neither.
 *
 * See the TS file for the writer convention (always write; null = computed,
 * unkeyable; absent = never computed) and for why normalized_title keeps
 * ASCII dedup semantics while edition_key is Unicode-aware.
 */

// ---- dedup.ts ports (ASCII semantics — deliberate, see TS header) ----------
// The two dedup-key normalizers used to be pasted here as well. They now live
// in ONE scripts-side module so every importer in scripts/ shares them
// (#4444); re-exported so existing callers of this file are unaffected.

export { normalizeTitle, normalizeAuthor } from './dedup-normalize.mjs';
import { normalizeTitle, normalizeAuthor } from './dedup-normalize.mjs';

const LATIN_ORDINALS = {
  primus: 1, prima: 1, secundus: 2, secunda: 2, tertius: 3, tertia: 3,
  quartus: 4, quarta: 4, quintus: 5, quinta: 5, sextus: 6, septimus: 7,
  octavus: 8, nonus: 9, decimus: 10,
};

function romanToInt(s) {
  const map = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]];
    const next = map[s[i + 1]];
    if (cur == null) return null;
    total += next != null && cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}

export function extractVolume(title) {
  if (!title) return null;
  const t = String(title).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const KW = '(?:vol(?:ume)?|tom(?:us|o|e)?|band|part|pt|liber|deel|teil)\\.?\\s*\\(?\\s*';
  let m = t.match(new RegExp(`\\b${KW}(\\d{1,3})\\b`));
  if (m) return parseInt(m[1], 10);
  m = t.match(new RegExp(`\\b${KW}(${Object.keys(LATIN_ORDINALS).join('|')})\\b`));
  if (m) return LATIN_ORDINALS[m[1]] ?? null;
  m = t.match(new RegExp(`\\b${KW}([ivxlcdm]{1,6})\\b`));
  if (m) return romanToInt(m[1]);
  return null;
}

export function editionYear(book) {
  if (typeof book.year === 'number' && book.year > 0) return book.year;
  if (book.published) {
    const m = String(book.published).match(/\b(\d{3,4})\b/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

// ---- edition-key.ts ports (Unicode-aware) ----------------------------------

const UNINFORMATIVE_TITLES = new Set([
  'unknown', 'untitled', 'no title', 'title unknown', 'manuscript', 'ms',
  'miscellany', 'fragment', 'fragments',
]);

const MIN_TITLE_LENGTH = 5;

const DENSE_SCRIPT = /[　-鿿豈-﫿぀-ヿ가-힯]/;

export function normalizeEditionTitle(title) {
  return String(title || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|i|el|los|las)\s+/i, '')
    .replace(/\s*[([:]?\s*(vol\.?\s*\d+|tomus?\s*\d+|part\.?\s*\d+|band\s*\d+|tome?\s*\d+)[)\]]?\s*$/i, '')
    .replace(/[^\p{L}\p{N}\s_]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function editionSurname(author) {
  const cleaned = String(author || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*\([\d\s\-–,?.]+\)\s*/g, '')
    .replace(/[^\w\s,]/g, '')
    .trim();
  if (!cleaned) return '';
  return cleaned.includes(',') ? cleaned.split(',')[0].trim() : cleaned.split(/\s+/).pop() || '';
}

export function buildEditionKey(book) {
  const rawTitle = book.title || book.display_title || '';
  const title = normalizeEditionTitle(rawTitle);
  const author = editionSurname(book.author);
  const year = editionYear(book);
  const volume = extractVolume(book.display_title) ?? extractVolume(book.title) ?? null;
  const parts = { title, author, year, volume };

  if (!title) return { key: null, quality: null, parts, reason: 'no-title' };
  const minLength = DENSE_SCRIPT.test(title) ? 2 : MIN_TITLE_LENGTH;
  if (title.length < minLength) return { key: null, quality: null, parts, reason: 'title-too-short' };
  if (UNINFORMATIVE_TITLES.has(title)) return { key: null, quality: null, parts, reason: 'title-uninformative' };

  const quality =
    author && year != null ? 'full' : author ? 'no-year' : year != null ? 'no-author' : 'title-only';

  return { key: `${title}|${author}|${year ?? ''}|v${volume ?? ''}`, quality, parts };
}

// ---- the composed writer ----------------------------------------------------

export function computeIdentityFields(book) {
  const edition = buildEditionKey(book);
  return {
    normalized_title: normalizeTitle(String(book.title || '')),
    normalized_author: normalizeAuthor(String(book.author || '')),
    edition_key: edition.key,
    edition_key_quality: edition.quality,
  };
}
