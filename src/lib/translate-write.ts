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
import { getDb } from './mongodb';
import { createRevision } from './page-revisions';
import { contentHash } from './steganographia';

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
    .replace(/<[^>]+>/g, ' ')
    .replace(/->|<-/g, ' ')
    .replace(WS_ENTITY, ' ')
    .replace(LEADER_RUN, ' ');
  for (const [re, ch] of TEXT_ENTITIES) out = out.replace(re, ch);
  return out.replace(/\s+/g, ' ').trim().length;
}

/** True when there is nothing on this page for a translator to work from. */
export function hasNoTranslatableBody(ocrText: string | null | undefined): boolean {
  return translatableBodyLen(ocrText) < MIN_TRANSLATABLE_BODY;
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
}

export interface WritePageTranslationResult {
  written: boolean;
  protected: boolean;
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
    promptRef, jobId, extraTranslationFields, extraSet, overwriteHuman = false,
  } = args;

  const db = await getDb();

  // Promise 1: the human-edit guard.
  const current = await db.collection('pages').findOne(
    { id: pageId },
    { projection: { 'translation.source': 1, 'translation.edited_by': 1, 'translation.data': 1 } }
  );
  const existing = current?.translation as HumanEditableField | undefined;
  if (isHumanEditedField(existing) && !overwriteHuman) {
    return { written: false, protected: true, text: existing?.data ?? '' };
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
