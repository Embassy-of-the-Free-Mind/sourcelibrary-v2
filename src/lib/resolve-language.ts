import { displayLanguage, sameLanguage } from '@/lib/language-utils';
import { languageCode, languageRow } from '@/lib/language-normalize';
import type { FieldProvenanceEntry } from '@/lib/types/book';

/**
 * Language/date resolution for book imports — issue #2185.
 *
 * The bug (#2184): every import route set `language` from CALLER input first,
 * with the source's own structured metadata used only as a last resort (or not
 * at all). A caller passing "Latin" (the *work* language of Pico's Oratio)
 * silently overrode IA's `metadata.language: "rus"` (the *manifestation*
 * language — the scan is a 20th-c. Russian translation).
 *
 * The fix flips precedence: empirical SOURCE signals decide the manifestation
 * `language`; the caller's value becomes the work hint (`original_language`).
 * When the two disagree we don't silently pick — we flag `language_review` and
 * record BOTH claims (the value + its source) in `field_provenance.language`,
 * so a wrong value can no longer wear a trustworthy "internet_archive" badge.
 *
 * A `LanguageSignal` carries both the raw value and where it came from. Pass
 * source signals in PRIORITY ORDER (most empirical first, e.g. OCR-detected
 * before catalogued metadata before collection tags).
 */
export interface LanguageSignal {
  /** Raw token — ISO code (`rus`, `la`) or display name (`Russian`). */
  value: string | null | undefined;
  /** Provenance label, e.g. 'ia_ocr_detected', 'ia_metadata', 'iiif_manifest'. */
  source: string;
  /**
   * Why this signal cannot be trusted on this item (see assessIaOcrLanguage).
   * A discounted signal is still recorded in the claims, but never picked.
   */
  discounted?: string | null;
}

/** IA's `ocr_detected_script` names → ISO 15924, folded to comparable groups. */
const IA_SCRIPT: Record<string, string> = {
  latin: 'Latn', fraktur: 'Latn', greek: 'Grek', cyrillic: 'Cyrl', arabic: 'Arab', hebrew: 'Hebr',
  devanagari: 'Deva', tibetan: 'Tibt', han: 'CJK', hans: 'CJK', hant: 'CJK',
  hangul: 'CJK', japanese: 'CJK', katakana: 'CJK', hiragana: 'CJK',
};
const SCRIPT_GROUP: Record<string, string> = { Cyrs: 'Cyrl', Hani: 'CJK', Jpan: 'CJK', Kore: 'CJK' };
const scriptGroup = (s: string) => SCRIPT_GROUP[s] || s;

/**
 * Should IA's `ocr_detected_lang` be believed on this item? Returns the reason it
 * should NOT, or null when it may lead (#4582).
 *
 * The signal is derived FROM IA's OCR, so it is noise on exactly the material
 * where that OCR fails — and it fails silently, at `ocr_detected_lang_conf: 1.0`:
 * Arabic script comes back as Latin-letter garbage that reads as "Latin", a
 * hieroglyphic lithograph as Kyrgyz, Latin Google scans as Russian, Sanskrit as
 * Hindi/Marathi/Nepali, Tibetan as Dzongkha. It still beats the catalogue when
 * it is coherent — on Latin-script books it was right 5/5 against a wrong
 * catalogue record (scripts/lib/ia-language.mjs) — so this does not demote it
 * wholesale; it names the four measured failure shapes:
 *
 *   ocr-multi-script        IA saw 3+ scripts: it was guessing (Urkunden: 6, "ky").
 *   ocr-unknown-language    a code our registry cannot place (ky, ne, dz) against
 *                           a language some other signal does name.
 *   ocr-script-mismatch     the language is not written in the script IA itself
 *                           detected (ru/el/hi on a "Latin"-script scan).
 *   ocr-cannot-read-script  a Latin-script reading of a book the catalogue (or,
 *                           failing that, the caller) puts in a non-Latin script.
 *   ocr-same-script-cousin  a different language in the catalogue's own non-Latin
 *                           script: IA has no Sanskrit/Tibetan model and answers
 *                           with the nearest modern neighbour.
 *
 * `ocrScripts` is IA's raw `ocr_detected_script` (string or array), unsliced.
 */
export function assessIaOcrLanguage(opts: {
  ocrLang?: string | null;
  ocrScripts?: string | string[] | null;
  catalogLang?: string | null;
  callerLang?: string | null;
}): string | null {
  const ocrCode = languageCode(opts.ocrLang);
  if (!ocrCode && !displayLanguage(opts.ocrLang)) return null; // no signal to judge
  const scripts = (Array.isArray(opts.ocrScripts) ? opts.ocrScripts : [opts.ocrScripts])
    .filter((s): s is string => typeof s === 'string' && !!s.trim());
  if (scripts.length >= 3) return 'ocr-multi-script';

  const catalogRow = languageRow(languageCode(opts.catalogLang));
  const refRow = catalogRow || languageRow(languageCode(opts.callerLang));
  const ocrRow = languageRow(ocrCode);
  if (!ocrRow) return displayLanguage(opts.catalogLang) || displayLanguage(opts.callerLang) ? 'ocr-unknown-language' : null;

  const seen = scripts.length ? IA_SCRIPT[scripts[0].trim().toLowerCase()] : undefined;
  if (seen && !ocrRow.ambiguous_script && scriptGroup(ocrRow.script) !== seen) return 'ocr-script-mismatch';

  if (refRow && !refRow.ambiguous_script && ocrRow.script === 'Latn' && refRow.script !== 'Latn') {
    return 'ocr-cannot-read-script';
  }
  if (catalogRow && catalogRow.script !== 'Latn' && scriptGroup(catalogRow.script) === scriptGroup(ocrRow.script)
      && catalogRow.family !== ocrRow.family) {
    return 'ocr-same-script-cousin';
  }
  return null;
}

export interface ResolveLanguageInput {
  /** Caller-supplied manifestation language (request body `language`). */
  callerLanguage?: string | null;
  /** Caller-supplied work-language hint (request body `original_language`). */
  callerOriginalLanguage?: string | null;
  /** Empirical signals from the source, most-trustworthy first. */
  sourceSignals?: LanguageSignal[];
  /** Label for the caller's signal in provenance (default 'caller'). */
  callerSource?: string;
}

export interface ResolveLanguageResult {
  /** Resolved manifestation language (display name), or 'Unknown'. */
  language: string;
  /** Work language, when known to differ from the manifestation. */
  original_language: string | null;
  /** True when the manifestation language differs from the work language. */
  is_translation: boolean;
  /** True when caller and source disagreed on the manifestation language. */
  conflict: boolean;
  /**
   * True when the record must NOT auto-publish pending human review.
   * Set on any caller-vs-source conflict, and when the caller's value alone
   * overrode a discounted source signal (#4582).
   */
  language_review: boolean;
  /** Ready to store at `field_provenance.language`. */
  provenance: FieldProvenanceEntry;
}

/**
 * Resolve the manifestation language for an imported book, recording provenance.
 *
 * Precedence:
 *   1. First non-empty, non-discounted SOURCE signal (in the order given) wins the manifestation language.
 *   2. If the source is silent, fall back to the caller's value.
 *   3. If both are silent, 'Unknown'.
 *
 * Conflict (caller present, source present, they disagree):
 *   - manifestation = source value (the artifact's real language)
 *   - original_language = caller value (the work hint)
 *   - is_translation = true, conflict = true, language_review = true
 */
export function resolveLanguage(input: ResolveLanguageInput): ResolveLanguageResult {
  const callerSource = input.callerSource || 'caller';
  const caller = displayLanguage(input.callerLanguage);
  const callerOriginal = displayLanguage(input.callerOriginalLanguage);

  // First usable source signal, preserving the caller's intended priority order.
  // A DISCOUNTED signal (#4582) is evidence we record but never let decide.
  const presentSignals = (input.sourceSignals || [])
    .map((s) => ({ source: s.source, value: displayLanguage(s.value), raw: s.value, discounted: s.discounted || null }))
    .filter((s) => s.value);
  const usableSignals = presentSignals.filter((s) => !s.discounted);
  const sourcePick = usableSignals[0] || null;

  // All distinct claims, for provenance.
  const claims: Array<{ source: string; value: string; discounted?: string }> = [];
  if (caller) claims.push({ source: callerSource, value: caller });
  for (const s of presentSignals) {
    if (!claims.some((c) => c.source === s.source && sameLanguage(c.value, s.value!))) {
      claims.push({ source: s.source, value: s.value!, ...(s.discounted ? { discounted: s.discounted } : {}) });
    }
  }

  let language: string;
  let original_language: string | null = callerOriginal;
  let is_translation = false;
  let conflict = false;
  let chosenSource: string;

  if (sourcePick && caller && !sameLanguage(sourcePick.value, caller)) {
    // The defect's core case: source and caller disagree → trust the artifact,
    // demote the caller to the work hint, and flag for review.
    language = sourcePick.value!;
    original_language = callerOriginal || caller;
    is_translation = true;
    conflict = true;
    chosenSource = sourcePick.source;
  } else if (sourcePick) {
    // Source present and either agrees with or has no competing caller value.
    language = sourcePick.value!;
    chosenSource = sourcePick.source;
  } else if (caller) {
    // No source signal at all — caller is the only evidence we have.
    language = caller;
    chosenSource = callerSource;
  } else {
    language = 'Unknown';
    chosenSource = 'none';
  }

  // Don't keep original_language === language (FRBR work == manifestation).
  if (original_language && sameLanguage(original_language, language)) {
    original_language = null;
    is_translation = false;
  }

  const provenance: FieldProvenanceEntry = {
    source: 'import',
    value: language,
    chosen_from: chosenSource,
    claims,
    ...(conflict ? { conflict: true } : {}),
    date: new Date().toISOString(),
  };

  // The caller's word alone overrode a source signal we discounted: that is a
  // judgment call, not a conflict — no is_translation — but a person should look.
  const discountedDisagrees = presentSignals.some((s) => s.discounted && !sameLanguage(s.value, language));
  const language_review = conflict || (chosenSource === callerSource && discountedDisagrees);

  return { language, original_language, is_translation, conflict, language_review, provenance };
}

/**
 * Resolve the manifestation/edition date for an import (#2185).
 *
 * Same shape of bug as language: callers pass the *work*-composition year
 * (Pico: 1486) which overrode the source's edition/scan date. Prefer the
 * source date for the manifestation; route a caller-only year to
 * `original_work_year` rather than letting it masquerade as the edition date.
 */
export interface ResolveDateResult {
  /** Manifestation `published` value, or null. */
  published: string | null;
  /** Work-composition year when the caller supplied one the source lacks. */
  original_work_year: string | null;
}

export function resolveDate(opts: {
  callerPublished?: string | null;
  callerYear?: string | number | null;
  sourceDate?: string | null;
}): ResolveDateResult {
  const sourceDate = clean(opts.sourceDate);
  const callerDate = clean(opts.callerPublished) || clean(opts.callerYear != null ? String(opts.callerYear) : null);

  if (sourceDate) {
    // Source has a real edition/scan date — it wins the manifestation date.
    // A differing caller year is the work-composition year.
    const callerYear = extractYear(callerDate);
    const sourceYear = extractYear(sourceDate);
    return {
      published: sourceDate,
      original_work_year: callerYear && callerYear !== sourceYear ? callerYear : null,
    };
  }

  // No source date. Do NOT promote a caller's work-composition year to the
  // manifestation date — leave `published` null and stash the year as the work year.
  return { published: null, original_work_year: extractYear(callerDate) };
}

function clean(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = String(s).trim();
  return !t || /^unknown$/i.test(t) ? null : t;
}

function extractYear(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/-?\d{3,4}/);
  return m ? m[0] : null;
}

/**
 * The numeric `year` that date range-filters read (#3267).
 *
 * `books.published` is FREE TEXT — `circa 1600`, `[1620]`, `1628.`, `n.d.`,
 * roman numerals — so it can never be range-compared. `year` is the filterable
 * twin, and a book without one is invisible to every date filter in search.
 * Import routes must set it whenever `published` yields a plausible year.
 *
 * Returns null rather than guessing: no digits (`n.d.`, `MDCXXVIII`) or an
 * implausible run (a shelfmark, a page count) leaves the field unset, which is
 * honest — an absent `year` reads as "unknown", a wrong one silently misfiles
 * the book into another century's results.
 */
export function publishedToYear(published?: string | number | null): number | null {
  if (published == null) return null;
  if (typeof published === 'number') return isPlausibleYear(published) ? published : null;
  const raw = extractYear(clean(published));
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && isPlausibleYear(n) ? n : null;
}

function isPlausibleYear(n: number): boolean {
  // Widest defensible window for a physical artefact we could hold: no future
  // imprints, and a floor well below the oldest datable text in the corpus.
  return n >= -3000 && n <= new Date().getFullYear() + 1;
}
