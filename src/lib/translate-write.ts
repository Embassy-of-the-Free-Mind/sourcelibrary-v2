/**
 * translate-write — the TS-side door for writing a page translation (#3749).
 *
 * TypeScript twin of scripts/lib/translate-core.mjs `writePageTranslation`.
 * The script lanes got a human-edit guard in #3725/#3734; until this module,
 * the TS writers (Lambda worker, batch-async collectors, /api/process) wrote
 * translations with NO guard, so "no automated process can overwrite a human
 * edit" was only true for scripts.
 *
 * The promises this door enforces:
 *   1. HUMAN-EDIT GUARD — a translation a person wrote or corrected by hand
 *      (`source: 'manual'`, or `edited_by` set) is never silently replaced by
 *      AI output. Refuse by default; a caller that REALLY means it passes
 *      `overwriteHuman: true`.
 *   2. REVISION BEFORE OVERWRITE — existing content is snapshotted into
 *      `page_revisions` via createRevision() before the write (non-fatal on
 *      failure, matching long-standing worker behavior).
 *   3. PROVENANCE — prompt_id / prompt_hash / prompt_name / prompt_version are
 *      stamped when provided.
 *
 * Existing call sites keep their bespoke write payloads and wire the guard in
 * via the primitives (`isHumanEditedTranslation`, `findHumanEditedPageIds`);
 * NEW TS writers should go through `writePageTranslation` directly.
 *
 * Parity with the .mjs door is pinned by tests/unit/translate-write-guard.test.ts.
 */
import type { Db } from 'mongodb';
import { nanoid } from 'nanoid';
import { getDb } from './mongodb';
import { createRevision } from './page-revisions';
import { stripMarkupTags } from './strip-markup-tags';
import { contentHash, missingProvenance, isNotRecorded, GEMINI_SOURCES, type GeminiEngine, type NotRecorded } from './write-provenance'; // 16-hex hash + the provenance contract (#4613)

/**
 * `$unset` fragment every translation writer includes (#4927). `translation_stale`
 * is the materialised verdict that the stored translation was made from a
 * transcription the page no longer holds (`ocr.updated_at` newer than
 * `translation.updated_at`); a new translation is the exit, so every writer
 * clears it in the same update. Twin of `CLEAR_STALE_UNSET` in
 * `scripts/lib/stale-translation.mjs`.
 */
export const CLEAR_STALE_UNSET = Object.freeze({ translation_stale: '' } as const);

/**
 * Does this OCR carry anything a translator could translate?
 *
 * TS twin of `bodyLen` / `MIN_TRANSLATABLE_BODY` in `scripts/lib/translate-core.mjs`;
 * `tests/unit/translate-empty-source.test.ts` pins the two together.
 *
 * Page 170 of Kircher's *Iter extaticum II* is a blank leaf whose OCR is 18,561
 * characters of `&nbsp;` padding around a folio number. Counting those six-character
 * entities as text made it look like a substantial source, so it was sent to the
 * translator, which filled the vacuum with a fabricated 2011 nephrology journal table
 * of contents — live to readers, and one deposit from a permanent DOI (#4960).
 *
 * A model handed nothing does not decline; it invents, and the invention is
 * indistinguishable downstream from a real translation. So the check is on the
 * SOURCE, pre-flight, and the call is never billed.
 */
const WS_ENTITY = /&(?:nbsp|ensp|emsp|thinsp|hairsp|#0*160|#[xX]0*a0|#8194|#8195|#8201);/g;
const LEADER_RUN = /([.·•․‧_\-–—=~*])\1{3,}/g;
const TEXT_ENTITIES: Array<[RegExp, string]> = [
  [/&amp;/g, '&'], [/&lt;/g, '<'], [/&gt;/g, '>'], [/&quot;/g, '"'], [/&#0*39;|&apos;/g, "'"],
];

/** Characters of real body below which a page has nothing to translate. */
export const MIN_TRANSLATABLE_BODY = 24;

/** Length of the part of an OCR response that is actually words on the page. */
export function translatableBodyLen(text: string | null | undefined): number {
  if (!text) return 0;
  let out = String(text)
    // Centring markers first, and a tag starts with a letter; see bodyLen in
    // scripts/lib/translate-core.mjs (#5105).
    .replace(/->|<-/g, ' ')
    .replace(/<\/?[a-zA-Z][^<>]*>/g, ' ')
    .replace(WS_ENTITY, ' ')
    .replace(LEADER_RUN, ' ');
  for (const [re, ch] of TEXT_ENTITIES) out = out.replace(re, ch);
  return out.replace(/\s+/g, ' ').trim().length;
}

/**
 * Length of an illustration description the page carries instead of text.
 *
 * `<image-desc>` is stripped by `translatableBodyLen` — right for "how much
 * transcription is here", wrong for "is there anything to work from". An illustration
 * leaf has no words by definition, and the translate lane legitimately renders its
 * description as the `<note>` a reader sees. A gate that ignored this would have
 * silently stopped image descriptions corpus-wide.
 */
export function imageDescLen(text: string | null | undefined): number {
  if (!text) return 0;
  let total = 0;
  for (const m of String(text).matchAll(/<image-desc\b[^>]*>([\s\S]*?)<\/image-desc>/gi)) {
    total += stripMarkupTags(m[1]).replace(/\s+/g, ' ').trim().length;
  }
  return total;
}

/**
 * True when there is nothing on this page for a translator to work from — neither
 * words nor a described picture. The vacuum is the absence of both.
 */
export function hasNoTranslatableBody(ocrText: string | null | undefined): boolean {
  if (translatableBodyLen(ocrText) >= MIN_TRANSLATABLE_BODY) return false;
  if (imageDescLen(ocrText) >= MIN_TRANSLATABLE_BODY) return false;
  return true;
}

/**
 * Did the translator put the page inside its continuity <meta> (#5363, #5376)?
 *
 * TS twin of `hidesPageInMeta` in `scripts/lib/translate-core.mjs` (which reads
 * `metaPayload().wholePage` in `scripts/lib/page-integrity.mjs`);
 * `tests/unit/hidden-meta-guard.test.ts` pins the two together.
 *
 * The prompt asks for `<meta>continues from previous page: …</meta>` on a page that
 * opens mid-sentence. Sometimes the model writes the page's own lines after that
 * colon, and every reader surface strips `<meta>`, content and all — the reader is
 * shown a blank or near-blank page. True when the words after the marker are at
 * least 80% of everything the translation says and number at least 40 — under that
 * the meta is almost always a sentence of commentary on a near-empty leaf, and the
 * short body is the whole translation (sizing: HIDDEN_META_MIN_WORDS in the .mjs).
 */
export const HIDDEN_META_REASON = 'hidden-meta';
export const HIDDEN_META_MIN_WORDS = 40;
const META_WHOLE_PAGE_SHARE = 0.8;
const CONT_MARKER = /^[\s.…]*continue[sd]?\s+from\s+(?:the\s+)?previous\s+page\b/i;
const DESCRIPTIVE_LEAD = /^(?:['’]s\b|\s*,|\s+(?:and|where|which|in which|with|discussing|detailing|describing|regarding|concerning|about)\b)/i;
const TR_WRAPPERS = 'meta|summary|keywords|vocab|warning|note|header|page-num|sig|margin|catchword|image-desc|footnote|folio';
const TR_WRAPPER_RE = new RegExp(`<(${TR_WRAPPERS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi');

/** Letters and digits only — the length a reader reads (twin of page-integrity `readingLength`). */
function readingLength(t: string): number {
  const x = t.replace(/&nbsp;/g, ' ').replace(/&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, 'x')
    .replace(/\\[a-zA-Z]+/g, ' ').replace(/\[(?:unclear|illegible)[^\]]*\]/gi, ' ');
  return (x.match(/[\p{L}\p{N}]/gu) || []).length;
}

export function hidesPageInMeta(translationText: string | null | undefined): boolean {
  const tr = String(translationText || '');
  for (const m of tr.matchAll(/<meta>([\s\S]*?)<\/meta>/gi)) {
    const mk = m[1].match(CONT_MARKER);
    if (!mk) continue;
    // Only the FIRST continuity meta is judged, as in page-integrity `continuityMeta`.
    const rest = m[1].slice(mk[0].length);
    if (DESCRIPTIVE_LEAD.test(rest)) return false;
    const payload = rest.replace(/<\/?[a-zA-Z][^>]*>/g, ' ').replace(/^[\s:.…,;—–-]+/, '').replace(/\s+/g, ' ').trim();
    const words = payload.split(/\s+/).filter(w => /\p{L}/u.test(w)).length;
    if (words < HIDDEN_META_MIN_WORDS) return false;
    const shown = tr.replace(TR_WRAPPER_RE, ' ').replace(/<\/?[a-zA-Z][^>]*>/g, ' ').replace(/[*_#>`~|]/g, ' ');
    const hidden = readingLength(payload);
    return hidden / Math.max(1, hidden + readingLength(shown)) >= META_WHOLE_PAGE_SHARE;
  }
  return false;
}

/**
 * Record a refused translation on the page and keep its text. TS twin of
 * `recordRefusedTranslation` in `scripts/lib/translate-core.mjs`: the stamp
 * (`translation.health_blocked` + `_at`) is the recorded skip — the page stays
 * untranslated and says why — and the refused text goes to `page_revisions` with
 * `source: 'health-gate-refused'` (#3826), the row the repair lane restores from.
 * Never throws.
 */
export async function recordRefusedTranslation(
  db: Db,
  page: { id: string; book_id?: string },
  text: string,
  reason: string,
  opts: { jobId?: string; model?: string } = {}
): Promise<void> {
  const now = new Date();
  try {
    // A dotted $set cannot descend into `translation: null`.
    await db.collection('pages').updateOne({ id: page.id, translation: null }, { $set: { translation: {} } });
    await db.collection('pages').updateOne(
      { id: page.id },
      { $set: { 'translation.health_blocked': reason, 'translation.health_blocked_at': now, updated_at: now } }
    );
    const raw = text || '';
    await db.collection('page_revisions').insertOne({
      id: nanoid(12),
      page_id: page.id,
      book_id: page.book_id,
      field: 'translation',
      data: raw.slice(0, 50000),
      source: 'health-gate-refused',
      reason,
      original_length: raw.length,
      truncated: raw.length > 50000,
      model: opts.model,
      job_id: opts.jobId,
      created_at: now,
    });
  } catch (e) {
    console.error(`[health-gate] Failed to record refused translation for ${page.id}:`, e);
  }
}

/** Shape of an existing `translation` (or `ocr`) subdocument for guard checks. */
export interface HumanEditableField {
  source?: string;
  edited_by?: string | null;
  data?: string;
}

/**
 * THE human-edit predicate — one definition on the TS side, mirroring the
 * check inside scripts/lib/translate-core.mjs writePageTranslation:
 * `source === 'manual' || !!edited_by`.
 *
 * Works for both `translation` and `ocr` subdocuments — manual edits stamp
 * the same convention on both (see /api/pages/[id]: `ocr.source = 'manual'`,
 * `ocr.edited_by` / `translation.edited_by`).
 */
export function isHumanEditedField(existing: HumanEditableField | null | undefined): boolean {
  if (!existing) return false;
  return existing.source === 'manual' || !!existing.edited_by;
}

/** Alias making translation-guard call sites read naturally. */
export const isHumanEditedTranslation = isHumanEditedField;

/**
 * Bulk form of the guard for batch collectors: which of these pages have a
 * human-edited `field` (translation | ocr)? Returns the Set of protected page
 * ids — batch results for those pages must be skipped, not written.
 */
export async function findHumanEditedPageIds(
  db: Db,
  pageIds: string[],
  field: 'translation' | 'ocr' = 'translation'
): Promise<Set<string>> {
  if (!pageIds || pageIds.length === 0) return new Set();
  const docs = await db.collection('pages').find(
    {
      id: { $in: pageIds },
      $or: [
        { [`${field}.source`]: 'manual' },
        { [`${field}.edited_by`]: { $exists: true, $nin: [null, ''] } },
      ],
    },
    { projection: { id: 1 } }
  ).toArray();
  return new Set(docs.map(d => d.id as string));
}

export interface TranslationPromptRef {
  id?: string;
  name?: string;
  version?: number | string;
  content_hash?: string;
}

export interface WritePageTranslationArgs {
  pageId: string;
  /** The new translation text. */
  text: string;
  /** Model that produced the text (stamped on the subdocument). */
  model?: string;
  /** Provenance of the writing lane. Defaults to 'ai'. */
  source?: string;
  /** Target language. Defaults to 'English'. */
  language?: string;
  /** Prompt provenance — stamped as prompt_id/hash/name/version when provided. */
  promptRef?: TranslationPromptRef;
  /** Job identifier, recorded on the revision row. */
  jobId?: string;
  /** Extra fields merged INTO the translation subdocument (e.g. batch_job_id, token counts). */
  extraTranslationFields?: Record<string, unknown>;
  /** Extra TOP-LEVEL page fields to $set in the same write — never translation.* keys. */
  extraSet?: Record<string, unknown>;
  /** Bypass the human-edit guard. Only for callers acting on explicit human intent. */
  overwriteHuman?: boolean;
  /**
   * What produced this text (#4613): a block from geminiEngine()/engineFromBatchJob(), or
   * notRecorded(reason) for a restore. REQUIRED for model output (`source` 'ai' /
   * 'batch_api'); a person's edit (`source: 'manual'`) carries none.
   */
  engine?: GeminiEngine | NotRecorded;
}

export interface WritePageTranslationResult {
  written: boolean;
  protected: boolean;
  /** Set when the text was refused (e.g. 'hidden-meta', #5376): nothing was written, the reason is on the page. */
  refused?: string;
  /**
   * When protected, the EXISTING human translation (use it for previous-page
   * continuity); when written, the new text.
   */
  text: string;
}

/**
 * Guard + revision + write, mirroring scripts/lib/translate-core.mjs
 * writePageTranslation. Refuses (written:false, protected:true) if the page's
 * current translation is human-edited and `overwriteHuman` was not passed.
 */
export async function writePageTranslation(
  args: WritePageTranslationArgs
): Promise<WritePageTranslationResult> {
  const {
    pageId, text, model, source = 'ai', language = 'English',
    promptRef, jobId, extraTranslationFields, extraSet, overwriteHuman = false, engine,
  } = args;

  // Model output must say what produced it (#4613) — refuse rather than stamp a partial record.
  if (GEMINI_SOURCES.has(source) && !engine) {
    throw new Error(`writePageTranslation: source '${source}' requires \`engine\` (geminiEngine()/engineFromBatchJob(), or notRecorded(reason) for a restore) — #4613`);
  }
  if (engine && !isNotRecorded(engine)) {
    const m = missingProvenance('translation', { data: text, source, updated_at: new Date(), content_hash: contentHash(text), engine });
    if (m.missing.length) throw new Error(`writePageTranslation: engine block incomplete — ${m.missing.join(', ')}`);
  }

  const db = await getDb();

  // Promise 1: the human-edit guard.
  const current = await db.collection('pages').findOne(
    { id: pageId },
    { projection: { book_id: 1, 'translation.source': 1, 'translation.edited_by': 1, 'translation.data': 1 } }
  );
  const existing = current?.translation as HumanEditableField | undefined;
  if (isHumanEditedField(existing) && !overwriteHuman) {
    return { written: false, protected: true, text: existing?.data ?? '' };
  }

  // Model output whose continuity <meta> holds the page is never stored (#5376) — the reader
  // would be shown an empty page. The refusal is recorded on the page and the text kept.
  if (GEMINI_SOURCES.has(source) && hidesPageInMeta(text)) {
    await recordRefusedTranslation(db, { id: pageId, book_id: current?.book_id as string | undefined }, text, HIDDEN_META_REASON, { jobId, model });
    return { written: false, protected: false, refused: HIDDEN_META_REASON, text };
  }

  // Promise 2: snapshot existing content first (non-fatal — createRevision
  // catches its own errors and never blocks the write path).
  await createRevision(pageId, 'translation', jobId);

  // Promise 3: provenance-stamped write.
  const now = new Date();
  await db.collection('pages').updateOne(
    { id: pageId },
    {
      $set: {
        translation: {
          data: text,
          content_hash: contentHash(text),
          language,
          ...(model && { model }),
          updated_at: now,
          source,
          ...(promptRef && {
            prompt_version: String(promptRef.version ?? ''),
            ...(promptRef.id && { prompt_id: promptRef.id }),
            ...(promptRef.content_hash && { prompt_hash: promptRef.content_hash }),
            ...(promptRef.name && { prompt_name: promptRef.name }),
          }),
          ...(engine && { engine }),
          ...(extraTranslationFields || {}),
        },
        ...(extraSet || {}),
        updated_at: now,
      },
      $unset: CLEAR_STALE_UNSET,
    }
  );
  return { written: true, protected: false, text };
}

/**
 * Double-submit guard for the batch-async submit routes (archaeology I68):
 * find a still-pending batch job for the same book + type, created within the
 * last 48h, whose results have not been collected. Submitting again while one
 * is pending pays Gemini twice for the same pages — the routes return 409
 * with this job's info instead (bypass with `resubmit: true`).
 */
export async function findPendingBatchJob(
  db: Db,
  opts: { bookId: string; type: 'translation' | 'ocr'; tenantId?: string; windowHours?: number }
): Promise<{ jobName?: string; status?: string; pageCount?: number; createdAt?: Date } | null> {
  const windowMs = (opts.windowHours ?? 48) * 60 * 60 * 1000;
  const doc = await db.collection('batch_jobs').findOne(
    {
      book_id: opts.bookId,
      type: opts.type,
      ...(opts.tenantId && { tenantId: opts.tenantId }),
      // "Pending" = not failed/cancelled/expired (raw Gemini states included —
      // the GET collectors write raw JOB_STATE_* strings, scripts write
      // 'failed') and results not yet collected.
      status: {
        $nin: [
          'failed', 'cancelled', 'expired',
          'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED',
          'BATCH_STATE_FAILED', 'BATCH_STATE_CANCELLED',
        ],
      },
      results_collected: { $ne: true },
      created_at: { $gte: new Date(Date.now() - windowMs) },
    },
    { sort: { created_at: -1 }, projection: { job_name: 1, status: 1, page_count: 1, created_at: 1 } }
  );
  if (!doc) return null;
  return {
    jobName: doc.job_name,
    status: doc.status,
    pageCount: doc.page_count,
    createdAt: doc.created_at,
  };
}
