/**
 * translate-core — the one door for writing a page translation (issue #3725).
 *
 * Every code path that produces a translation (worker, batch collector, repair
 * script, one-off) must go through this module rather than carrying its own
 * copy of the logic. The door enforces the four promises of the pipeline:
 *
 *   1. The MODEL is chosen by routing (getTranslateModelForBook), never
 *      hardcoded — BPH and non-Latin-script books get full flash, the rest lite.
 *   2. The PROMPT comes from the `prompts` DB collection (loadTranslationPrompts),
 *      and every written page records which prompt produced it.
 *   3. Nothing is overwritten without a `page_revisions` snapshot first
 *      (writePageTranslation does this internally — callers cannot forget it).
 *   4. The book's cached counters are recomputed with the canonical
 *      visible-pages convention (syncBookTranslationCounters → page-counts.mjs).
 *
 * TS twin for API routes: src/lib/types/ai-models.ts (routing) +
 * src/lib/prompts.ts (prompt fetch) + src/lib/page-counts.ts (counters).
 * Parity is pinned by tests/unit/translate-core-parity.test.ts — if you change
 * routing here or in ai-models.ts, change both or the suite fails.
 */

import { createHash } from 'crypto';
import { buildVisiblePageCountPipeline } from './page-counts.mjs';
import { saveRevisionBeforeOverwrite } from './page-revisions.mjs';

export const MODEL_FLASH = 'gemini-3-flash-preview';
export const MODEL_LITE = 'gemini-3.1-flash-lite';

/**
 * Mirror of LATIN_SCRIPT_LANGUAGES in src/lib/types/ai-models.ts — the
 * allowlist of languages safe for the cheaper lite model. Allowlist (not
 * denylist) so unknown/null routes to the safer full model.
 *
 * NOTE: Malay is deliberately absent. Our Malay holdings are mostly Jawi
 * (Arabic-script) manuscripts — flash-lite garbles them into confident
 * nonsense (2026-07-18 Hikayat Tanah Hitu pilot). Malay must route to full
 * flash. A drifted copy of this list in translate-worker.mjs used to include
 * it, which is exactly why the copies were consolidated here.
 */
export const LATIN_SCRIPT_LANGUAGES = new Set([
  'english', 'en', 'eng',
  'latin', 'la', 'lat',
  'french', 'fr', 'fra',
  'italian', 'it', 'ita',
  'spanish', 'es', 'spa',
  'portuguese', 'pt', 'por',
  'romanian', 'ro', 'ron', 'rum',
  'catalan', 'ca', 'cat',
  'german', 'de', 'deu', 'ger',
  'dutch', 'nl', 'nld', 'dut',
  'swedish', 'sv', 'swe',
  'norwegian', 'no', 'nor',
  'danish', 'da', 'dan',
  'finnish', 'fi', 'fin',
  'icelandic', 'is', 'isl', 'ice',
  'welsh', 'cy', 'cym', 'wel',
  'irish', 'ga', 'gle',
  'polish', 'pl', 'pol',
  'czech', 'cs', 'ces', 'cze',
  'slovak', 'sk', 'slk', 'slo',
  'slovenian', 'sl', 'slv',
  'croatian', 'hr', 'hrv',
  'hungarian', 'hu', 'hun',
  'estonian', 'et', 'est',
  'latvian', 'lv', 'lav',
  'lithuanian', 'lt', 'lit',
  'albanian', 'sq', 'sqi', 'alb',
  'turkish', 'tr', 'tur',
  'indonesian', 'id', 'ind',
  'vietnamese', 'vi', 'vie',
  'tagalog', 'tl', 'tgl', 'filipino',
  'swahili', 'sw', 'swa',
]);

export function isLatinScriptLanguage(language) {
  if (!language) return false;
  return LATIN_SCRIPT_LANGUAGES.has(String(language).toLowerCase().trim());
}

/**
 * THE model routing for OCR/translation. Mirrors getModelForBook in
 * src/lib/types/ai-models.ts.
 */
export function getTranslateModelForBook(book) {
  if (book?.image_source?.provider === 'bph') return MODEL_FLASH;
  if (!isLatinScriptLanguage(book?.language)) return MODEL_FLASH;
  return MODEL_LITE;
}

/**
 * Safety settings required on EVERY translation call: without BLOCK_NONE,
 * pre-1930 public-domain works trip RECITATION/safety refusals page after page
 * (2026-03-28 lesson). The pre-1930 note added by buildTranslationPrompt is
 * the other half of that fix.
 */
export const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
];

/**
 * Load the default translation + english_modernization prompts from the DB.
 * Throws if either is missing — a silent hardcoded fallback is how prompt
 * provenance was lost before; scripts should fail loudly instead.
 *
 * Returns { translation, english }, each { text, ref } where ref carries
 * { id, name, version, content_hash } for page provenance stamping.
 */
export async function loadTranslationPrompts(db) {
  const load = async (type) => {
    const doc = await db.collection('prompts').findOne(
      { type, is_default: true },
      { sort: { version: -1 } }
    );
    if (!doc?.content) {
      throw new Error(
        `[translate-core] No default '${type}' prompt in the prompts collection — seed it before running (prompts are DB-owned, never hardcoded).`
      );
    }
    return {
      text: doc.content,
      ref: {
        id: doc._id?.toString(),
        name: doc.name,
        version: doc.version,
        content_hash: doc.content_hash
          || createHash('md5').update(doc.content).digest('hex'),
      },
    };
  };
  return {
    translation: await load('translation'),
    english: await load('english_modernization'),
  };
}

/** English books are modernized, not translated. */
export function isEnglishBook(book) {
  return (book?.language || '').toLowerCase().trim() === 'english';
}

/**
 * Build the full user prompt for one page, mirroring the production worker:
 * language substitution, source-work metadata, the pre-1930 public-domain
 * note, the page text, and previous-page continuity (the chain that makes
 * translation sequential — see the pipeline explainer).
 */
export function buildTranslationPrompt({ prompts, book, ocrText, previousTranslation }) {
  const english = isEnglishBook(book);
  const base = english ? prompts.english : prompts.translation;
  let prompt = base.text
    .replace('{source_language}', book?.language || 'Latin')
    .replace('{target_language}', 'English')
    .replace('{language}', book?.language || 'Latin');

  const parts = [];
  if (book?.display_title || book?.title) parts.push(`Title: ${book.display_title || book.title}`);
  if (book?.author) parts.push(`Author: ${book.author}`);
  if (book?.year || book?.published) parts.push(`Date: ${book.year || book.published}`);
  if (parts.length) prompt += `\n\n**Source work:** ${parts.join(' | ')}`;

  const year = parseInt(book?.year || book?.published, 10);
  if (year && year < 1930) {
    prompt += `\n\n**Note:** This is a public domain work published in ${year}. It is not under copyright.`;
  }

  prompt += english
    ? `\n\n**Text to modernize:**\n${ocrText}`
    : `\n\n**Text to translate:**\n${ocrText}`;

  if (previousTranslation) {
    prompt += english
      ? `\n\n**Previous page (modernized) for continuity:**\n${previousTranslation.slice(0, 2000)}...`
      : `\n\n**Previous page translation for continuity:**\n${previousTranslation.slice(0, 2000)}...`;
  }

  return { prompt, promptRef: base.ref, isEnglish: english };
}

/** Close unterminated inline tags the model sometimes emits mid-stream. */
export function sanitizeTranslationTags(text) {
  if (!text) return text;
  return text
    .replace(/<(margin|gloss|insert|unclear|term|heading|footnote|caption)>([^<]*?)$/gm,
      (_, tag, content) => `<${tag}>${content}</${tag}>`)
    .replace(/<\/(margin|gloss|insert|unclear|term|heading|footnote|caption)>\s*<\/\1>/g,
      (_, tag) => `</${tag}>`);
}

export const contentHash = (t) =>
  createHash('sha256').update(t || '').digest('hex').slice(0, 16);

// ────────────────────────────────────────────────────────────────────────────
// Semantic health (issue #3756): collapse / runaway detection at the door.
// Extracted verbatim from scripts/maintenance/retranslate-pages.mjs (which
// mirrored detect-translation-collapse.mjs) so every writer can ask "is this
// translation plausibly real?" instead of only the repair script knowing.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Editorial wrapper tags stripped before measuring the translation BODY.
 * A page whose output is only <summary>/<keywords>/<note> wrappers has no
 * actual translation, however long the raw string is.
 */
export const BLOCK_TAGS = ['meta','image-desc','vocab','summary','keywords','warning','note',
  'scan-quality','language','page-type','page-num','header','sig','insert','columns','script'];
const blockRe = new RegExp(`<(${BLOCK_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi');
const looseRe = new RegExp(`</?(${BLOCK_TAGS.join('|')})\\b[^>]*>`, 'gi');

/** Length of the prose body after stripping wrappers, tags, and whitespace. */
export function bodyLen(text) {
  if (!text) return 0;
  return String(text).replace(blockRe, ' ').replace(looseRe, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/->|<-/g, ' ').replace(/\s+/g, ' ').trim().length;
}

/**
 * Collapse = the translation BODY is genuinely short in absolute terms (empty
 * or a sliver). The absolute cap is essential: dense pages and pages with
 * huge/artifact-inflated OCR have a low body RATIO but a perfectly adequate
 * translation — they are NOT collapses. (Verified 2026-06-16: ratio-only
 * flagged ~20% false positives from oversized OCR denominators.)
 */
export const COLLAPSE_ABS_CAP = 800;
export const isCollapsed = (ocr, tr) => {
  const ob = bodyLen(ocr), tb = bodyLen(tr);
  if (ob < 400) return false;
  if (tb >= COLLAPSE_ABS_CAP) return false;
  return tb / ob < 0.3 || (/continued from previous page/i.test(tr || '') && tb < 60);
};

/**
 * Runaway / repetition loop: translation body far longer than its own OCR
 * body. Body-based to avoid false positives on low-OCR pages (headers,
 * image-only). The 3× ratio deliberately clears normal CJK→English expansion
 * (~3× in chars — #2532 found length-ratio runaway flags were ~97% false
 * positives on CJK; real loops need a repetition metric, this only catches
 * the gross ones).
 */
export const isExcess = (ocr, tr) => {
  if ((tr || '').length > 20000) return true;
  const ob = bodyLen(ocr), tb = bodyLen(tr);
  return ob >= 300 && tb > ob * 3;
};

/**
 * THE semantic health check for a freshly generated translation.
 * @returns {{healthy: boolean, reason: 'collapsed'|'runaway'|null}}
 */
export function assessTranslationHealth(ocrText, translationText) {
  if (isCollapsed(ocrText, translationText)) return { healthy: false, reason: 'collapsed' };
  if (isExcess(ocrText, translationText)) return { healthy: false, reason: 'runaway' };
  return { healthy: true, reason: null };
}

// ────────────────────────────────────────────────────────────────────────────
// Edge cases (issue #3734): one definition of "is this page translatable",
// replacing ~10 forked skip-lists across writers, and the blank-from-OCR
// detection that previously lived only inside translate-worker.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Page types that no translation lane should translate. Union of the forks
 * this replaced: defaults.ts had [blank, exlibris, bookplate]; translate-worker
 * had [blank, digitizer-notice]. Kept equal to the TS canonical
 * SKIP_TRANSLATION_PAGE_TYPES in src/lib/types/prompts/defaults.ts — pinned by
 * tests/unit/translate-edge-cases.test.ts.
 */
export const SKIP_TRANSLATION_PAGE_TYPES = ['blank', 'exlibris', 'bookplate', 'digitizer-notice'];

/**
 * Old OCR outputs (pre-pipeline) can describe a blank page without the page
 * ever getting page_type: 'blank'. Detect them from the OCR text itself so
 * every lane skips them (previously only translate-worker knew this pattern).
 */
export function isBlankFromOcr(ocrText) {
  const t = ocrText || '';
  return /<lang>\s*None\s*<\/lang>/i.test(t) && /blank\s+page/i.test(t);
}

/**
 * THE translatability check. Returns { ok, reason } so callers can count and
 * log why pages were excluded rather than silently dropping them.
 *
 * Reasons: 'soft-hidden' (page_number <= 0 — never renders, #3293),
 * 'skip-type', 'no-ocr', 'blank-ocr', 'recitation-blocked', 'safety-blocked'.
 *
 * opts.extraSkipTypes extends (never replaces) the canonical list — e.g.
 * retranslate-stale deliberately also skips illustrations and title pages.
 */
export function isTranslatablePage(page, { extraSkipTypes = [] } = {}) {
  if ((page?.page_number ?? 0) <= 0) return { ok: false, reason: 'soft-hidden' };
  const skip = new Set([...SKIP_TRANSLATION_PAGE_TYPES, ...extraSkipTypes]);
  if (page?.page_type && skip.has(page.page_type)) return { ok: false, reason: 'skip-type' };
  const ocr = page?.ocr?.data;
  if (typeof ocr !== 'string' || ocr === '') return { ok: false, reason: 'no-ocr' };
  if (isBlankFromOcr(ocr)) return { ok: false, reason: 'blank-ocr' };
  if (page?.translation?.recitation_blocked) return { ok: false, reason: 'recitation-blocked' };
  if (page?.translation?.safety_blocked) return { ok: false, reason: 'safety-blocked' };
  return { ok: true };
}

/**
 * Mongo match fragment expressing the same rule for selection queries (the
 * blank-from-OCR regex is intentionally not expressible here — apply
 * isTranslatablePage to fetched docs for that final filter).
 */
export function translatablePageFilter({ extraSkipTypes = [] } = {}) {
  return {
    page_number: { $gt: 0 },
    'ocr.data': { $exists: true, $nin: [null, ''] },
    page_type: { $nin: [...SKIP_TRANSLATION_PAGE_TYPES, ...extraSkipTypes] },
    'translation.recitation_blocked': { $ne: true },
    'translation.safety_blocked': { $ne: true },
  };
}

/**
 * Snapshot the page's current translation into page_revisions, then write the
 * new one with full provenance. Promise 3 lives here so no caller can forget
 * it. Non-fatal revision failure is logged, never blocks the write (matching
 * the production worker's long-standing behavior).
 *
 * @param {object} args
 * @param {object} args.page       page doc with at least { id, book_id }
 * @param {object} args.book      book doc (for model routing when model omitted)
 * @param {string} args.text      the new translation text (already sanitized or not — we sanitize again, idempotent)
 * @param {object} args.promptRef  { id, name, version, content_hash } from loadTranslationPrompts
 * @param {string} [args.model]   override; defaults to getTranslateModelForBook(book)
 * @param {string} [args.jobId]   job identifier for the revision row
 * @param {string} [args.note]    revision reason (e.g. 'anomaly-fix', 'retranslate_stale')
 * @param {object} [args.extraSet] extra top-level page fields to $set in the same write
 *                                (e.g. detected_terms) — never translation.* keys
 * @param {boolean} [args.overwriteHuman=false] bypass the human-edit guard
 * @param {boolean} [args.refuseUnhealthy=false] OPT-IN semantic health gate:
 *   assess the new text against the page's OCR (assessTranslationHealth) and
 *   refuse to write a collapsed/runaway result, returning
 *   {written:false, unhealthy:true, reason}. Deliberately NOT default-on —
 *   the production worker's behavior must not change silently (#3756).
 * @returns {{written: boolean, protected: boolean, unhealthy?: boolean, reason?: string, text: string}}
 *   — when protected, `text` is the EXISTING human translation (use it for
 *   previous-page continuity); when written, it is the sanitized new text.
 */
export async function writePageTranslation(db, { page, book, text, promptRef, model, jobId, note, extraSet, overwriteHuman = false, refuseUnhealthy = false }) {
  const clean = sanitizeTranslationTags(text);

  // Opt-in semantic health gate (#3756): never persist an obviously collapsed
  // or runaway translation. Checked before any DB access — an unhealthy result
  // must leave no trace (no revision snapshot, no write).
  if (refuseUnhealthy) {
    const health = assessTranslationHealth(page?.ocr?.data, clean);
    if (!health.healthy) {
      return { written: false, protected: false, unhealthy: true, reason: health.reason, text: clean };
    }
  }

  // Human-edit guard (#3734): a translation a person wrote or corrected by
  // hand (source: 'manual', or edited_by set) must never be silently replaced
  // by AI output — no automated heuristic outranks a human. Refuse by default;
  // a caller that REALLY means it passes { overwriteHuman: true }.
  const current = await db.collection('pages').findOne(
    { id: page.id },
    { projection: { 'translation.source': 1, 'translation.edited_by': 1, 'translation.data': 1 } }
  );
  const existing = current?.translation;
  const isHumanEdited = !!existing && (existing.source === 'manual' || !!existing.edited_by);
  if (isHumanEdited && !overwriteHuman) {
    return { written: false, protected: true, text: existing.data };
  }

  // Promise 3 delegates to the blessed revision helper (scripts/lib/
  // page-revisions.mjs): marker-text skip, reason field, never throws.
  await saveRevisionBeforeOverwrite(db, page.id, 'translation', { jobId, reason: note });

  await db.collection('pages').updateOne(
    { id: page.id },
    {
      $set: {
        translation: {
          data: clean,
          content_hash: contentHash(clean),
          language: 'English',
          model: model || getTranslateModelForBook(book),
          updated_at: new Date(),
          source: 'ai',
          prompt_version: String(promptRef?.version ?? ''),
          prompt_id: promptRef?.id,
          prompt_hash: promptRef?.content_hash,
          prompt_name: promptRef?.name,
        },
        ...(extraSet || {}),
        updated_at: new Date(),
      },
    }
  );
  return { written: true, protected: false, text: clean };
}

/**
 * Recompute the book's cached page counters with the canonical visible-pages
 * convention (#3293) and bump updated_at (which the Supabase catalog sync
 * keys on — a counter write without updated_at is invisible downstream).
 * Extra fields (e.g. a status transition) ride along in the same update.
 */
export async function syncBookTranslationCounters(db, bookId, extraSet = {}) {
  const [counts] = await db.collection('pages')
    .aggregate(buildVisiblePageCountPipeline(bookId)).toArray();
  const $set = { updated_at: new Date(), ...extraSet };
  if (counts) {
    $set.pages_count = counts.total;
    $set.pages_ocr = counts.with_ocr;
    $set.pages_translated = counts.with_translation;
  }
  await db.collection('books').updateOne({ id: bookId }, { $set });
  return counts || null;
}
