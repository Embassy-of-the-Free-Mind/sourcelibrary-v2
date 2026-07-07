/**
 * Ranking tier for the original-vs-translation distinction (issue #2395).
 *
 * `text_role` is written by scripts/maintenance/classify-text-role.mjs:
 *   original | period-translation | modern-translation
 *
 * Lower rank = closer to the source = ranks higher in search:
 *   0  original-language source (incl. genuine English-native works)
 *   1  period translation (pre-~1700 historical artifact) / unknown
 *   2  modern translation (~18th c.+ standing in for an original)
 *
 * When text_role is missing (pages, imports newer than the last classifier
 * run), fall back to the old language proxy: a non-English scan is an
 * original-language source; an unclassified English book sits between
 * originals and modern translations — matching the previous behavior where
 * "original language beats English translations".
 */
export function textRoleRank(textRole?: string | null, language?: string | null): number {
  if (textRole === 'original') return 0;
  if (textRole === 'period-translation') return 1;
  if (textRole === 'modern-translation') return 2;
  return language && language !== 'English' ? 0 : 1;
}

/**
 * Metadata-only heuristic that assigns a `text_role` at import time, so newly
 * imported books are classified immediately instead of falling back to the
 * language proxy (textRoleRank above) until the offline sweep runs.
 *
 * KEEP IN SYNC with scripts/maintenance/classify-text-role.mjs `classify()` —
 * the two must agree, or an import-time classification and the later sweep will
 * disagree on the same book. The regexes below are copied verbatim from there.
 * Issue #2395.
 *
 * Uses only fields known at insert: language, title, author, original_language,
 * and a year (from `year`, else parsed from `published` / `original_work_year`).
 */
const enLike = (v?: string | null) => !v || /^(english|en)$/i.test(String(v).trim());

const TRANS_TITLE = /transl|englished|rendered into english|done into english|made english|from the (greek|latin|hebrew|arabic|sanskrit|german|french|italian|chinese|tibetan|persian|coptic|aramaic|syriac)|\bloeb\b|sacred books of the east/i;
const TRANS_AUTHOR = /\btr(ans)?\.?\b|translated by|;\s*tr\b/i;
const CLASSICAL = /\b(plato|aristotle|plotinus|proclus|iamblichus|porphyry|plutarch|pythagoras|ptolemy|galen|hippocrates|homer|hesiod|sophocles|euripides|aeschylus|epictetus|marcus aurelius|sextus empiricus|philo|origen|cicero|seneca|virgil|ovid|lucretius|apuleius|boethius|aquinas|avicenna|averroes|al-biruni|al-kindi|maimonides|hermes trismegistus|laozi|lao tzu|confucius|zhuangzi|mencius|xunzi|patanjali|shankara|kabir|rumi|hafiz|sa'di|nagarjuna|padmasambhava)\b/i;
const LOEB = /\b(loeb|sacred books of the east)\b/i;

export type TextRole = 'original' | 'period-translation' | 'modern-translation';

export interface ClassifiableBook {
  language?: string | null;
  title?: string | null;
  author?: string | null;
  original_language?: string | null;
  year?: number | string | null;
  published?: string | null;
  original_work_year?: number | string | null;
  /**
   * Explicit "this scan is a translation" hint from the import driver. The ONLY
   * reliable signal for a non-English *translation* (Chaignet's French
   * Damascius, Charles's English John of Nikiu) — the language proxy below
   * assumes every non-English scan is an original and would mislabel these.
   */
  is_translation?: boolean | null;
}

/** First 4-digit year found in the given values, or NaN. */
function coerceYear(...vals: Array<number | string | null | undefined>): number {
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === 'number' && v > 0) return v;
    const m = String(v).match(/\d{4}/);
    if (m) return Number(m[0]);
  }
  return NaN;
}

export function classifyTextRole(book: ClassifiableBook): { text_role: TextRole; original_in_scan: boolean } {
  // Explicit translation hint wins over the language proxy below (which would
  // otherwise force any non-English scan to 'original'). Split by era so a
  // pre-1700 rendering still reads as a period-translation artifact. #2395.
  if (book.is_translation === true) {
    const yr = coerceYear(book.year, book.published, book.original_work_year);
    const role: TextRole = yr && yr > 0 && yr < 1700 ? 'period-translation' : 'modern-translation';
    return { text_role: role, original_in_scan: false };
  }

  // Non-English scan → original-language source.
  if (!enLike(book.language)) return { text_role: 'original', original_in_scan: false };

  const t = book.title || '';
  const a = book.author || '';
  const sigOrig = book.original_language && !enLike(book.original_language);
  const sigTitle = TRANS_TITLE.test(t);
  const sigAuth = TRANS_AUTHOR.test(a);
  const sigClassical = CLASSICAL.test(a) || CLASSICAL.test(t);
  const loeb = LOEB.test(t) || LOEB.test(a);

  if (!(sigOrig || sigTitle || sigAuth || sigClassical)) {
    // English book, no translation signal → English-native original.
    return { text_role: 'original', original_in_scan: false };
  }
  if (loeb) return { text_role: 'modern-translation', original_in_scan: true };
  const yr = coerceYear(book.year, book.published, book.original_work_year);
  if (yr && yr > 0 && yr < 1700) return { text_role: 'period-translation', original_in_scan: false };
  return { text_role: 'modern-translation', original_in_scan: false };
}

/**
 * Mutates a book doc in place to set `text_role` (+ `original_in_scan` for
 * Loeb/facing-page) before insert. `text_role_source: 'import-heuristic-v1'`
 * marks it as auto-derived at import (distinct from the offline 'heuristic-v1'
 * sweep) and, like that sweep, still wants human QA before any gate fully
 * trusts it. Call right before `insertOne`.
 */
export function applyTextRole(bookDoc: Record<string, unknown>): void {
  // A caller that already knows the role (explicit import metadata, or a human
  // QA value) wins — only auto-derive when text_role is absent. This lets an
  // import driver hard-set `text_role` for editions the heuristic can't read.
  if (typeof bookDoc.text_role === 'string' && bookDoc.text_role) {
    if (!bookDoc.text_role_source) bookDoc.text_role_source = 'import-explicit';
    return;
  }
  const { text_role, original_in_scan } = classifyTextRole(bookDoc as ClassifiableBook);
  bookDoc.text_role = text_role;
  bookDoc.text_role_source = 'import-heuristic-v1';
  if (original_in_scan) bookDoc.original_in_scan = true;
}
