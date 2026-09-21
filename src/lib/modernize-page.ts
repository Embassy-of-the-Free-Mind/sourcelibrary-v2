/**
 * PRIOR ART: this IS the body of `src/app/api/pages/[id]/modernize/route.ts`, lifted so
 * that its tenant twin `src/app/api/[tenant]/pages/[id]/modernize/route.ts` cannot drift
 * from it. The two were copies, and only one of them would have received the gate added
 * below — the failure recorded in `lesson_second_resolver_never_screened` (a guard on one
 * resolver left the twin unscreened for weeks). `src/app/api/pages/[id]/transliterate/
 * route.ts` is the sibling on-demand lane whose gating and fixed-model rules this follows.
 *
 * Modernize one page, on demand.
 *
 * WHAT CHANGED (#4958, 2026-09-21). Modernization used to arrive two ways: this route,
 * which a reader triggers, and Phase 4 of the pipeline, which generated an English
 * "modernization" into `translation.data` for every English book at any date. The
 * pipeline half is gone — it produced a second English text on modern-print books that
 * the reader never displays, while still setting `pages_translated` and
 * `is_fully_translated`. This lane is now the only way a modernization is made, so it
 * carries the protections the bulk path never needed:
 *
 *   - An anonymous-caller gate. Generation is a paid Gemini call; cached serves stay
 *     free and ungated, exactly as the transliterate route does it. This route had NO
 *     gate at all while it was a secondary path.
 *   - A fixed model. The caller used to pass `model` in the request body, and it went
 *     straight to generation — so anyone could spend the anonymous budget on the most
 *     expensive model available. The transliterate route fixed this for itself; the
 *     twin kept the hole.
 *
 * WHICH TEXT GETS MODERNIZED. For a translated book the source is the translation (an
 * English rendering that may itself read stiffly). For an English book there is no
 * translation — the source is the transcription, and the job is orthography: long ſ,
 * u/v and i/j letterforms, obsolete spelling. The cache is keyed on a hash of whichever
 * source was used, so re-running OCR or re-translating invalidates it.
 */
import type { Db } from 'mongodb';
import { performModernization } from '@/lib/ai';
import { logGeminiCall, type GeminiTrigger } from '@/lib/gemini-logger';
import { isArchaicOrthography } from '@/lib/archaic-orthography';

/**
 * What these functions need off a `pages` document. The index signature is load-bearing:
 * callers hand us a raw `WithId<Document>` from the driver, which has no declared
 * properties in common with a closed interface.
 */
export interface PageLike {
  ocr?: { data?: string };
  translation?: { data?: string };
  modernized?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Likewise for the `books` document — only `language` is read. */
export interface BookLike {
  language?: string | null;
  [key: string]: unknown;
}

/**
 * One model, named here, never taken from the caller. Lite is the lane the pipeline's
 * own English modernization used, so this is the same cost and the same output class.
 */
export const MODERNIZATION_MODEL = 'gemini-3.1-flash-lite';

/** Cheap change-detector for cache invalidation — not a checksum, just a fingerprint. */
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}

const ENGLISH = ['english', 'eng', 'en'];
export const isEnglishEdition = (language?: string | null) =>
  ENGLISH.includes(String(language ?? '').toLowerCase());

export type ModernizeSource = 'translation' | 'ocr';

export interface ModernizeOutcome {
  status: number;
  body: Record<string, unknown>;
  /** True when a paid call was made — the caller logs usage only in that case. */
  generated: boolean;
}

/**
 * Resolve which text this page's modernization is built from.
 *
 * Order matters: a book can be English AND carry a translation (a bilingual edition, or
 * an English book whose `translation.data` is a modernization the pipeline wrote before
 * #4958). Preferring the existing translation keeps those books rendering exactly as
 * they do today rather than silently switching sources under them.
 */
export function resolveModernizationSource(
  page: PageLike,
  book: BookLike | null,
): { text: string; source: ModernizeSource } | null {
  if (page.translation?.data) return { text: page.translation.data, source: 'translation' };
  if (isEnglishEdition(book?.language) && page.ocr?.data) {
    return { text: page.ocr.data, source: 'ocr' };
  }
  return null;
}

/**
 * Would modernizing this text be a no-op?
 *
 * Derek's rule, 2026-09-21: *"if it is modern english, it should be the same as the
 * original text."* The honest consequence is not to generate it. A page with no archaic
 * letterforms or spelling has nothing for the v2 prompt to change, so a call would spend
 * money to (at best) return the input — and at worst return something subtly different,
 * which is exactly how a 1907 book acquired an Americanized second text.
 *
 * Only applies to the OCR lane. A stiff modern translation is a legitimate thing to
 * smooth out, and that judgement is not about orthography.
 */
export function wouldBeNoOp(text: string, source: ModernizeSource): boolean {
  return source === 'ocr' && !isArchaicOrthography(text);
}

/** The field that caches the result of each source, so the two never overwrite each other. */
const HASH_FIELD: Record<ModernizeSource, string> = {
  translation: 'source_translation_hash',
  ocr: 'source_ocr_hash',
};

/**
 * The cached-read half. Runs before any gate: serving text already paid for is free and
 * must never be rate-limited, or a reader who hits the cap loses access to a page that
 * costs nothing to show.
 */
export function readCachedModernization(
  page: PageLike,
  sourceHash: string,
  source: ModernizeSource,
): string | null {
  const m = page.modernized;
  if (!m?.data) return null;
  return m[HASH_FIELD[source]] === sourceHash ? (m.data as string) : null;
}

/**
 * The paid half. The caller is responsible for having run the anonymous gate first —
 * this function spends money.
 */
export async function generateModernization(
  db: Db,
  page: { id: string; book_id: string; page_number?: number },
  sourceText: string,
  source: ModernizeSource,
  sourceHash: string,
  opts: { customPrompt?: string; triggeredBy?: GeminiTrigger } = {},
): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } }> {
  const startTime = Date.now();

  // Previous page, for continuity of voice across a page break.
  let previousContext: { translation?: string; modernized?: string } | undefined;
  if ((page.page_number ?? 0) > 1) {
    const prev = await db.collection('pages').findOne({
      book_id: page.book_id,
      page_number: (page.page_number as number) - 1,
    });
    if (prev) {
      previousContext = {
        translation: source === 'ocr' ? prev.ocr?.data : prev.translation?.data,
        modernized: prev.modernized?.data,
      };
    }
  }

  const result = await performModernization(sourceText, previousContext, opts.customPrompt, MODERNIZATION_MODEL);

  await db.collection('pages').updateOne(
    { id: page.id },
    {
      $set: {
        'modernized.data': result.text,
        'modernized.model': MODERNIZATION_MODEL,
        'modernized.updated_at': new Date(),
        'modernized.source': source,
        [`modernized.${HASH_FIELD[source]}`]: sourceHash,
        updated_at: new Date(),
      },
    },
  );

  logGeminiCall({
    type: 'translation',
    mode: 'realtime',
    model: MODERNIZATION_MODEL,
    book_id: page.book_id,
    page_ids: [page.id],
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    status: 'success',
    duration_ms: Date.now() - startTime,
    prompt_version: source === 'ocr' ? 'modernize-english-v2' : 'modernize-inline-v1',
    endpoint: '/api/pages/modernize',
    triggered_by: opts.triggeredBy,
  });

  return result;
}

/**
 * Load the narrow English-orthography prompt from the `prompts` collection. Returns
 * undefined for the translation lane, which keeps `performModernization`'s built-in
 * prompt. A missing prompt row is not fatal — the built-in is a reasonable fallback and
 * a reader's click should not 500 because a DB row was renamed.
 */
export async function loadEnglishModernizationPrompt(db: Db, source: ModernizeSource): Promise<string | undefined> {
  if (source !== 'ocr') return undefined;
  const row = await db
    .collection('prompts')
    .findOne({ type: 'english_modernization', is_default: true }, { projection: { content: 1 } });
  return row?.content ?? undefined;
}
