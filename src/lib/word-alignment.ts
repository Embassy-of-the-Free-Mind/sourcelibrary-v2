/**
 * Word/phrase-level OCR↔translation alignment (issue #3091).
 *
 * Powers the reader's "trace" mode: click a phrase in the English translation
 * and the corresponding span lights up in the original-language OCR (and vice
 * versa). One cheap flash-lite call per page, generated lazily the first time
 * any reader asks, then cached forever on the page document as
 * `pages.word_alignment`.
 *
 * Distinct from src/lib/semantic-alignment.ts, which scores whole-page
 * OCR↔translation similarity for QA — this module produces the span-level
 * pairs a reader can interact with.
 *
 * Invariants:
 * - Both texts are passed through stripEditorialWrappers() BEFORE alignment,
 *   so a pair can never map into <meta>/<summary> editorial prose (the #2232
 *   misquote family). Span strings stored here are verbatim slices of the
 *   STRIPPED text.
 * - `ocr_hash`/`translation_hash` are sha256 of the stripped texts; a page
 *   edit or re-OCR self-invalidates the cache on the next read (same pattern
 *   as TransliterationData.source_ocr_hash).
 */

import { createHash } from 'crypto';
import type { Db } from 'mongodb';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { stripEditorialWrappers } from './strip-editorial-wrappers';
import { normalizeForSearch, locateSpan } from './align-text';
import { logGeminiCall } from './gemini-logger';

export const WORD_ALIGNMENT_VERSION = 1;
const ALIGNMENT_MODEL = 'gemini-3.1-flash-lite';
// A page of early-modern print is ~2-4K chars; anything past this is an
// outlier (indexes, dense tables) where alignment adds little. Truncating
// bounds cost and keeps the model focused.
const MAX_TEXT_CHARS = 20000;

export interface AlignmentPair {
  /** Verbatim span of the stripped SOURCE (OCR) text. */
  s: string;
  /** Verbatim span of the stripped TRANSLATION text. */
  t: string;
  /** Char offset of `s` in the stripped source (occurrence disambiguation). */
  so: number;
  /** Char offset of `t` in the stripped translation. */
  to: number;
  /** Verbatim span of the stripped TRANSLITERATION, when one was resolved. */
  r?: string;
  /** Char offset of `r` in the stripped transliteration. */
  ro?: number;
}

export interface WordAlignmentData {
  version: number;
  model: string;
  created_at: Date;
  /** sha256 of the STRIPPED ocr text this alignment was computed from. */
  ocr_hash: string;
  /** sha256 of the STRIPPED translation text. */
  translation_hash: string;
  /**
   * sha256 of the STRIPPED transliteration the `r` spans were resolved against.
   * Absent when the page has no transliteration, or when the romanized pass has
   * not run yet — both are normal states, and trace works without it.
   */
  translit_hash?: string;
  pairs: AlignmentPair[];
}

export type AlignmentResult =
  | { status: 'ready'; alignment: WordAlignmentData }
  | { status: 'missing_text' }   // page lacks OCR or translation
  | { status: 'unavailable' };   // generation not allowed/failed this request

export function hashAlignmentText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

interface PageLike {
  id: string;
  ocr?: { data?: string };
  translation?: { data?: string };
  transliteration?: { data?: string };
  word_alignment?: WordAlignmentData;
}

/**
 * Resolve the model's quoted span pairs to verified offsets in the stripped
 * texts. Pairs whose spans can't be found (hallucinated or mangled quotes)
 * are dropped — every stored pair is guaranteed to be locatable text.
 * Exported for unit tests.
 */
export function resolveAlignmentPairs(
  rawPairs: Array<{ src?: string; en?: string }>,
  sourceText: string,
  translationText: string,
): AlignmentPair[] {
  const srcNorm = normalizeForSearch(sourceText);
  const trNorm = normalizeForSearch(translationText);
  const out: AlignmentPair[] = [];
  let srcCursor = 0;
  let trCursor = 0;
  for (const p of rawPairs) {
    if (!p?.src || !p?.en) continue;
    const s = locateSpan(srcNorm, p.src, srcCursor);
    if (!s) continue;
    const t = locateSpan(trNorm, p.en, trCursor);
    if (!t) continue;
    // Advance cursors past the START (not end) of each match so overlapping
    // or nested spans from the model still resolve, while repeated phrases
    // bind to successive occurrences.
    srcCursor = s.normStart + 1;
    trCursor = t.normStart + 1;
    out.push({
      s: sourceText.slice(s.start, s.end),
      t: translationText.slice(t.start, t.end),
      so: s.start,
      to: t.start,
    });
  }
  return out;
}

/**
 * Attach romanized spans to already-resolved pairs.
 *
 * Deliberately a SECOND call rather than a third field on the alignment prompt:
 * measured on 12 pages, folding a `rom` field into the pair prompt dragged mean
 * source coverage from 74% to 67% and collapsed one page from 97% to 24%. That
 * prompt is load-bearing and stays byte-identical; the romanized mapping is
 * additive and may fail without costing trace anything.
 *
 * Every returned span is verified against the transliteration with locateSpan
 * and must advance monotonically (the romanization has the same words in the
 * same order as the source), so a hallucinated or out-of-order span is dropped
 * rather than highlighting the wrong words. Exported for unit tests.
 */
export function resolveRomanSpans(
  pairs: AlignmentPair[],
  rawSpans: Array<{ i?: number; rom?: string }>,
  translitText: string,
): AlignmentPair[] {
  const romNorm = normalizeForSearch(translitText);
  const byIndex = new Map<number, string>();
  for (const e of rawSpans) {
    if (typeof e?.i === 'number' && e.rom) byIndex.set(e.i, e.rom);
  }
  let cursor = 0;
  let lastStart = -1;
  return pairs.map((pair, i) => {
    const rom = byIndex.get(i);
    if (!rom) return pair;
    const hit = locateSpan(romNorm, rom, cursor);
    // Monotonicity: source order is romanization order, so each pair's match
    // must start strictly after the previous one's. Without this, locateSpan's
    // global fallback lets a mis-quoted span bind to an EARLIER occurrence and
    // highlight the wrong words. Drop it; the pair stays usable without `r`.
    if (!hit || hit.start <= lastStart) return pair;
    cursor = hit.normStart + 1;
    lastStart = hit.start;
    return { ...pair, r: translitText.slice(hit.start, hit.end), ro: hit.start };
  });
}

async function generateRomanSpans(
  pairs: AlignmentPair[],
  translitText: string,
  language: string,
): Promise<Array<{ i: number; rom: string }>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('No GEMINI_API_KEY configured');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: ALIGNMENT_MODEL,
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          spans: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                i: { type: SchemaType.INTEGER },
                rom: { type: SchemaType.STRING },
              },
              required: ['i', 'rom'],
            },
          },
        },
        required: ['spans'],
      },
    },
  });

  const prompt = `The text below is a page of ${language} transliterated into Latin script. It contains the same words, in the same order, as the ${language} original.

ROMANIZATION:
<<<
${translitText}
>>>

Below are numbered spans of the ${language} original, in reading order. For each, return the span of ROMANIZATION that transliterates it.

${pairs.map((p, i) => `[${i}] ${JSON.stringify(p.s)}`).join('\n')}

Rules:
- "rom" must be copied EXACTLY, character for character, from ROMANIZATION above — including its diacritics and punctuation. Never transliterate the span yourself; only copy from ROMANIZATION.
- The spans are in reading order, so their romanized counterparts appear in the same order in ROMANIZATION.
- If a span's counterpart is not present verbatim in ROMANIZATION, omit that entry entirely rather than guessing.`;

  const result = await model.generateContent(prompt);
  const parsed = JSON.parse(result.response.text()) as {
    spans?: Array<{ i: number; rom: string }>;
  };
  return Array.isArray(parsed.spans) ? parsed.spans : [];
}

async function generatePairs(
  sourceText: string,
  translationText: string,
  language: string,
): Promise<Array<{ src: string; en: string }>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('No GEMINI_API_KEY configured');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: ALIGNMENT_MODEL,
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          pairs: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                src: { type: SchemaType.STRING },
                en: { type: SchemaType.STRING },
              },
              required: ['src', 'en'],
            },
          },
        },
        required: ['pairs'],
      },
    },
  });

  const prompt = `You are aligning a page of a historical ${language} text with its English translation.

SOURCE (${language}):
<<<
${sourceText}
>>>

TRANSLATION (English):
<<<
${translationText}
>>>

Produce phrase-level alignment pairs mapping spans of the SOURCE to the spans of the TRANSLATION that render them.

Rules:
- "src" must be copied EXACTLY, character for character, from SOURCE (including line breaks, ligatures, and archaic spellings such as long s). "en" must be copied EXACTLY from TRANSLATION. Never translate, correct, or paraphrase — only copy.
- Be EXHAUSTIVE: work through the SOURCE from its first word to its last, and cover every sentence with pairs. Do not stop early and do not skip sentences.
- Prefer short spans: a clause, a noun phrase, or a key term (roughly 1-8 words). Break every sentence into several small pairs rather than one big pair.
- Skip only page numbers, catchwords, signature marks, and text with no counterpart in the other text.`;

  const result = await model.generateContent(prompt);
  const parsed = JSON.parse(result.response.text()) as {
    pairs?: Array<{ src: string; en: string }>;
  };
  return Array.isArray(parsed.pairs) ? parsed.pairs : [];
}

/**
 * Return the cached alignment for a page, or (when `allowGenerate`) create,
 * store, and return it. An empty `pairs` array is a valid cached result —
 * "we tried, nothing aligned" — so a hopeless page is only ever paid for once
 * per text revision.
 *
 * Romanized spans are a separate, cheaper stage: a page whose alignment is
 * already cached but which has since gained a transliteration pays only for the
 * romanized pass, never for a re-alignment.
 */
export async function getOrCreateWordAlignment(
  db: Db,
  page: PageLike,
  language: string,
  opts: { allowGenerate: boolean },
): Promise<AlignmentResult> {
  const ocrRaw = page.ocr?.data || '';
  const translationRaw = page.translation?.data || '';
  if (!ocrRaw.trim() || !translationRaw.trim()) return { status: 'missing_text' };

  const sourceText = stripEditorialWrappers(ocrRaw).slice(0, MAX_TEXT_CHARS);
  const translationText = stripEditorialWrappers(translationRaw).slice(0, MAX_TEXT_CHARS);
  if (!sourceText.trim() || !translationText.trim()) return { status: 'missing_text' };

  const translitRaw = page.transliteration?.data || '';
  const translitText = translitRaw.trim()
    ? stripEditorialWrappers(translitRaw).slice(0, MAX_TEXT_CHARS)
    : '';
  const translitHash = translitText.trim() ? hashAlignmentText(translitText) : undefined;

  const ocrHash = hashAlignmentText(sourceText);
  const translationHash = hashAlignmentText(translationText);

  const stored = page.word_alignment;
  const baseFresh =
    !!stored &&
    stored.version === WORD_ALIGNMENT_VERSION &&
    stored.ocr_hash === ocrHash &&
    stored.translation_hash === translationHash;
  // A page with no transliteration is never "stale" for want of romanized spans.
  const romFresh = !translitHash || stored?.translit_hash === translitHash;

  if (baseFresh && romFresh) {
    return { status: 'ready', alignment: stored! };
  }

  if (process.env.WORD_ALIGNMENT_ENABLED === '0') return { status: 'unavailable' };

  // Base alignment is good; only the romanized spans are missing. Pay for the
  // cheap pass alone, and serve the base pairs if even that fails.
  if (baseFresh && !romFresh && translitText) {
    if (!opts.allowGenerate) return { status: 'unavailable' };
    try {
      const rawSpans = await generateRomanSpans(stored!.pairs, translitText, language);
      const pairs = resolveRomanSpans(stored!.pairs, rawSpans, translitText);
      const alignment: WordAlignmentData = { ...stored!, pairs, translit_hash: translitHash };
      await db.collection('pages').updateOne(
        { id: page.id },
        { $set: { 'word_alignment.pairs': pairs, 'word_alignment.translit_hash': translitHash } },
      );
      return { status: 'ready', alignment };
    } catch {
      return { status: 'ready', alignment: stored! };
    }
  }

  if (!opts.allowGenerate) {
    return { status: 'unavailable' };
  }

  const startTime = Date.now();
  let rawPairs: Array<{ src: string; en: string }>;
  try {
    rawPairs = await generatePairs(sourceText, translationText, language);
  } catch (e) {
    await logGeminiCall({
      type: 'other',
      mode: 'realtime',
      model: ALIGNMENT_MODEL,
      input_tokens: 0,
      output_tokens: 0,
      status: 'failed',
      duration_ms: Date.now() - startTime,
      prompt_version: `word-alignment-v${WORD_ALIGNMENT_VERSION}`,
      endpoint: 'word-alignment',
      error_message: e instanceof Error ? e.message : String(e),
    }).catch(() => {});
    return { status: 'unavailable' };
  }

  let pairs = resolveAlignmentPairs(rawPairs, sourceText, translationText);
  // One line per page EVER (results are cached) — kept as a resolution-rate
  // canary: a big raw→resolved drop means the model is misquoting spans.
  console.log(`word-alignment: page ${page.id} raw=${rawPairs.length} resolved=${pairs.length}`);

  // Romanized spans: best-effort. A failure here must not lose the pairs above.
  let romHash: string | undefined;
  if (translitText && pairs.length) {
    try {
      pairs = resolveRomanSpans(pairs, await generateRomanSpans(pairs, translitText, language), translitText);
      romHash = translitHash;
    } catch (e) {
      console.log(`word-alignment: page ${page.id} romanized pass failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  const alignment: WordAlignmentData = {
    version: WORD_ALIGNMENT_VERSION,
    model: ALIGNMENT_MODEL,
    created_at: new Date(),
    ocr_hash: ocrHash,
    translation_hash: translationHash,
    ...(romHash ? { translit_hash: romHash } : {}),
    pairs,
  };

  await db.collection('pages').updateOne(
    { id: page.id },
    { $set: { word_alignment: alignment } },
  );

  await logGeminiCall({
    type: 'other',
    mode: 'realtime',
    model: ALIGNMENT_MODEL,
    input_tokens: Math.round((sourceText.length + translationText.length) / 4),
    output_tokens: Math.round(JSON.stringify(rawPairs).length / 4),
    status: 'success',
    duration_ms: Date.now() - startTime,
    prompt_version: `word-alignment-v${WORD_ALIGNMENT_VERSION}`,
    endpoint: 'word-alignment',
  }).catch(() => {});

  return { status: 'ready', alignment };
}
