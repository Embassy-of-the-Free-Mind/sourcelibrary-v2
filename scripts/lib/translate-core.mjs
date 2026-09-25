/**
 * translate-core — the one door for writing a page translation (issue #3725).
 *
 * Every code path that produces a translation (worker, batch collector, repair
 * script, one-off) must go through this module rather than carrying its own
 * copy of the logic. The door enforces the four promises of the pipeline:
 *
 *   1. The MODEL is chosen by routing (getTranslateModelForBook), never
 *      hardcoded — BPH books get full flash, everything else (Latin AND
 *      non-Latin scripts) gets lite. Translation routing differs from OCR
 *      routing on purpose since #4759; see getTranslateModelForBook.
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

import { createHash, randomBytes } from 'crypto';
import { buildVisiblePageCountPipeline } from './page-counts.mjs';
import { saveRevisionBeforeOverwrite } from './page-revisions.mjs';
import { loopVerdict } from './ocr-loop-guard.mjs';
import { CLEAR_STALE_UNSET } from './stale-translation.mjs';
import { resolvePageBreak, lookaheadSnippet, LOOKAHEAD_CLAUSE } from './page-break-devices.mjs';
import { echoedSource } from './page-integrity.mjs';

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
 * it, which is exactly why the copies were consolidated here. A second pair of
 * drifted copies, on the OCR side, carried it until 2026-09-04 — batch OCR now
 * reads this list too, via scripts/lib/ocr-routing.mjs. Do not paste this list
 * anywhere; import it. Parity across all three surviving implementations is
 * pinned by tests/unit/translate-core-parity.test.ts.
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
 * THE model routing for TRANSLATION. TS twin: getTranslateModelForBook in
 * src/lib/types/ai-models.ts (the Lambda sink). Parity between the two is
 * pinned by tests/unit/translate-core-parity.test.ts.
 *
 * This DELIBERATELY DIFFERS from OCR routing (getOcrModelForBook in
 * ocr-routing.mjs / getModelForBook in ai-models.ts) — issue #4759:
 *
 * - BPH books: full flash (partner institution's manuscripts).
 * - Tibetan: full flash (#4742 — measured exception, see isTibetanBook).
 * - Everything else, INCLUDING other non-Latin scripts: flash-lite.
 *
 * OCR keeps its non-Latin carve-out because flash-lite hallucinates when
 * VISUAL decoding is hard (#1726: a Bhutanese astrological text read as a
 * "ritual manual for weather control"). Translation reads `ocr.data` as
 * text — no visual decoding — and #1726 offered no translation evidence
 * when it swept translation along. The only translation A/B on record (#467,
 * six languages) favoured lite, and the free observational read over the
 * Mar 27 – May 12 2026 lite era (scripts/eval/results/translation-model-obs-*)
 * found no faithfulness gap. Worth ~$12K over 5.4M untranslated pages.
 * Do not "fix" this back into parity with OCR without new evidence.
 */
export function getTranslateModelForBook(book) {
  if (book?.image_source?.provider === 'bph') return MODEL_FLASH;
  if (isTibetanBook(book)) return MODEL_FLASH;
  return MODEL_LITE;
}

/**
 * Tibetan is the one measured exception to "non-Latin translates on lite" (#4742,
 * 2026-09-25). On 21 Kanjur pages judged blind against the 84000 English, lite
 * inverted a comparative negation ("does not approach a hundredth of the merit")
 * on both pages carrying it, collapsed a four-fold emptiness enumeration, and
 * misparsed the ṛddhipāda formula; flash-preview got all three right (median
 * fidelity 5 vs lite 5/4, invention 2.4% vs 4.8%). #4759's evidence was general
 * and did not include Buddhist canonical Tibetan. Matches "Tibetan" and the
 * compound labels that start with it ("Tibetan (script); Tibetan; Chinese").
 */
export function isTibetanBook(book) {
  return /^\s*tibetan\b/i.test(String(book?.language ?? ''));
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

// The previous page's translation, as continuity context. Three shapes have
// been measured on the pinned 58-seam sample (PR #4912, blind judge):
//
//   head      first 2,000 chars + '...'         production 2025-12-12 → 2026-09-22
//   tail      last 2,000 chars, blocks stripped  PR #4970, lost to head 13–24
//   hybrid    head 600 + […] + tail 1,400 + blocks   this — 13–16, a tie with head
//
// The head could not see the seam it was told to continue (#4968): on 5.5% of
// production seams page N ends mid-sentence and N+1 restarts the clause. But
// the tail alone lost the things the head carried, and the judge said which:
// running headers, page numbering, quote style, capitalisation, and name and
// term consistency — the last of which the <summary>/<keywords> blocks help
// with. So the hybrid keeps both ends and the blocks.
//
// Honest about the evidence: no variant beat another decisively. 19 of the 56
// judged prompts were byte-identical (short pages, where hybrid ≡ head) and
// the judge still split 6–5 on those, a 52.6% noise floor that the hybrid's
// 52.7% sits exactly on. The hybrid is chosen because it strictly contains
// what the head carried AND fixes the blind seam, not because it won.
export const CONTINUITY_CONTEXT_CHARS = 2000;
const CONTINUITY_HEAD_CHARS = 600;
const CONTINUITY_TAIL_CHARS = 1400;

/**
 * The prompt fragment carrying the previous page's translation. Empty string
 * when there is nothing to continue from.
 */
export function continuityContext(previousTranslation, { english = false } = {}) {
  if (!previousTranslation) return '';
  const raw = String(previousTranslation);
  // The blocks that close a page: dropped from the body so they cannot eat the
  // window, then re-appended whole — they name the page's people and terms.
  const blocks = (raw.match(/<(summary|keywords)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || []).join('\n');
  const body = raw.replace(/<(meta|summary|keywords|vocab|warning)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '').trim();
  if (!body && !blocks) return '';
  const core = body.length <= CONTINUITY_CONTEXT_CHARS
    ? body
    : `${body.slice(0, CONTINUITY_HEAD_CHARS)}\n[…]\n${body.slice(-CONTINUITY_TAIL_CHARS)}`;
  // The trailing '...' is production's own mark that the page is cut off here.
  // A page whose text already ends in an ellipsis would otherwise read
  // '......' — the one deliberate departure from the string that was judged,
  // and a cosmetic one (the arm carried the artifact and still tied).
  const seed = `${core}${blocks ? `\n${blocks}` : ''}...`.replace(/(?:\.\.\.|…)\s*\.\.\.$/, '...');
  return english
    ? `\n\n**Previous page (modernized) for continuity:**\n${seed}`
    : `\n\n**Previous page translation for continuity:**\n${seed}`;
}

/**
 * The part of a translation prompt that depends only on the book: the base
 * prompt from the DB with its placeholders filled, the source-work line and the
 * public-domain note. Shared by the single-page prompt below and the Batch API
 * lane's multi-page block prompt (translate-batch-seam.mjs), so the two cannot
 * drift apart.
 */
export function translationPromptHeader({ prompts, book }) {
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
  return { prompt, promptRef: base.ref, isEnglish: english };
}

/**
 * Page-break devices (#5103) — OFF by default; production is unchanged until a measured flip.
 *
 * The source-grounded seam judge (EXPERIMENTS.md 2026-09-25 late) found production defective at
 * 10 of 12 breaks where the page ends on a catchword or a split word, and at 3 in 4 mid-flow breaks
 * overall. The translator is told nothing about either device and sees only the previous page's
 * translation, never the next page's source. Four pieces, each switchable so a test can prove it
 * carries weight (tests/unit/translate-page-break.test.ts):
 *
 *   splitWords   "Augspur-" | "gischen" is joined onto the page where it begins and the fragment is
 *                removed from the next page's translatable text          (page-break-devices.mjs)
 *   catchwords   a trailing catchword is removed from the page's text and named as a printer's device
 *   lookahead    the SOURCE of the next page's first sentence is sent as context, so a sentence that
 *                crosses the break is translated knowing how it ends
 *   rule         one prompt line naming catchwords and split words
 *
 * Pass `pageBreak: PAGE_BREAK_FIX` with `prevOcrText` / `nextOcrText` to enable. With `pageBreak`
 * absent the prompt is byte-identical to what it was before this option existed.
 */
export const PAGE_BREAK_FIX = Object.freeze({ splitWords: true, catchwords: true, lookahead: true, rule: true });

export const PAGE_BREAK_RULE = '**Page breaks:** a catchword (the next page\'s first word printed again at the foot of this page) is a printer\'s device, not text: never translate it. A word split by a hyphen at the page break is one word: translate it once, on the page where it begins. A sentence that runs across the break is translated in the light of how it continues, but only this page\'s words are rendered here: never repeat or complete the next page\'s words.';

/**
 * The SCOPED form (#5103, the flip candidate): edits + rule line, no lookahead, and applied only to a
 * page that actually ends on (or begins after) a split word or a catchword. On every other page the
 * prompt is byte-identical to production — pinned by tests/unit/translate-page-break.test.ts. Measured
 * 2026-09-25: the lookahead is where the duplications came from (flash-lite renders "context only"
 * text), and the edits alone halved the share of device breaks carrying a defect.
 */
export const PAGE_BREAK_SCOPED = Object.freeze({ splitWords: true, catchwords: true, lookahead: false, rule: true, scoped: true });

/**
 * Resolve the devices around ONE page: the break before it (a word the previous page began, a
 * catchword it repeats) and the break after it (its own foot). Pure; the prompt builders below
 * decide whether to APPLY the result (`pageBreak.scoped` applies it only when something fired).
 *
 * @returns {{ text: string, notes: string[], lookahead: string, fired: boolean, meta: object }}
 */
export function resolvePageBreakForPage({ ocrText, prevOcrText, nextOcrText, pageBreak }) {
  let text = ocrText;
  const notes = [];
  let lookahead = '';
  const meta = { kind: null, joined: null, catchword: null, headJoined: null, headRemoved: null, lookahead: false };
  const edits = { splitWords: !!pageBreak.splitWords, catchwords: !!pageBreak.catchwords };
  // The break BEFORE this page: a word the previous page began is translated there.
  if (prevOcrText && (edits.splitWords || edits.catchwords)) {
    const head = resolvePageBreak(prevOcrText, text, edits);
    text = head.ocrNext;
    if (head.joined) {
      meta.headJoined = head.joined;
      notes.push(`The word «${head.joined}» was split across the break from the previous page and is translated there; this page's text begins after it.`);
    } else if (head.removedFromNext) {
      meta.headRemoved = head.removedFromNext;
      notes.push(`The word «${head.removedFromNext}» at the head of this page repeats the previous page's catchword and has been removed; it is not translated twice.`);
    }
  }
  // The break AFTER this page: the devices at its foot, and the next page's opening as context.
  if (nextOcrText) {
    const foot = resolvePageBreak(text, nextOcrText, edits);
    if (edits.splitWords || edits.catchwords) text = foot.ocrN;
    meta.kind = foot.kind;
    meta.joined = foot.joined;
    meta.catchword = foot.catchword;
    // "ordinary text … like any other word": round 3 (EXPERIMENTS.md 2026-09-26) counted untranslated
    // words on the fix arm; the joined word, set apart in «», must not read as a term to preserve.
    if (foot.joined) notes.push(`This page ends with the word «${foot.joined}», completed from the top of the next page; it is ordinary text of this page, so translate it here as part of its sentence like any other word — do not leave it in the original.`);
    // A tagged catchword that is the second half of the joined word ("gischen" under
    // "Augspur-") is part of that word, not a separate device to warn about.
    const partOfJoin = foot.joined && foot.catchword && foot.joined.toLowerCase().includes(foot.catchword.toLowerCase().replace(/[^\p{L}]/gu, ''));
    if (foot.catchword && edits.catchwords && !partOfJoin) notes.push(`The catchword «${foot.catchword}» at the foot of this page is a printer's device repeating the next page's first word: it is not text of this page and must not be translated.`);
    // lookahead: true = the first sentence; 'clause' = only to the first clause boundary.
    if (pageBreak.lookahead) {
      lookahead = lookaheadSnippet(foot.ocrNext, pageBreak.lookahead === 'clause' ? LOOKAHEAD_CLAUSE : {});
      meta.lookahead = !!lookahead;
    }
  }
  const fired = !!(meta.headJoined || meta.headRemoved || meta.kind || meta.catchword);
  return { text, notes, lookahead, fired, meta };
}

export function buildTranslationPrompt({ prompts, book, ocrText, previousTranslation, prevOcrText, nextOcrText, pageBreak }) {
  const { prompt: header, promptRef, isEnglish: english } = translationPromptHeader({ prompts, book });
  let prompt = header;

  const r = pageBreak ? resolvePageBreakForPage({ ocrText, prevOcrText, nextOcrText, pageBreak }) : null;
  // Scoped: a page with no device at either break gets production's prompt, byte for byte.
  const applied = !!r && (!pageBreak.scoped || r.fired);
  const text = applied ? r.text : ocrText;
  if (applied && pageBreak.rule) prompt += `\n\n${PAGE_BREAK_RULE}`;

  prompt += english
    ? `\n\n**Text to modernize:**\n${text}`
    : `\n\n**Text to translate:**\n${text}`;

  if (applied && r.notes.length) prompt += `\n\n**At the page break:** ${r.notes.join(' ')}`;
  if (applied && r.lookahead) prompt += `\n\n**The next page opens (source, for context only; do NOT translate it, the next page carries it):**\n${r.lookahead}`;

  prompt += continuityContext(previousTranslation, { english });

  return { prompt, promptRef, isEnglish: english, pageBreak: r ? { ...r.meta, fired: r.fired, applied } : null };
}

/**
 * THE block prompt: production translates BATCH_SIZE (8) consecutive pages in one call
 * (translate-worker.mjs translateBatch), the previous block's last translation as continuity, each
 * page wrapped in `<translation page="N">`. Moved here from the worker's inline assembly (2026-09-25)
 * so the worker and the evals send the same bytes — the Batch-lane harness had carried a drifting
 * copy. `pages` are `{ page_number, ocr }` with `ocr` a string or the page's `ocr` object.
 *
 * With `pageBreak`, every in-block break is resolved page against page (the block's first and last
 * pages against `prevOcrText` / `nextOcrText`); the lookahead is never used in a block, the next
 * page is already in the prompt. Under `scoped`, a block in which no page fired is byte-identical
 * to production; in one that did, only the pages that fired are edited or annotated, and the rule
 * line is added once.
 *
 * A break is only resolved between pages whose `page_number`s are consecutive: the worker's block
 * is drawn from the pages still to translate, so two neighbours in the array can be pages 16 and
 * 18, and a hyphen at the foot of 16 must not be "completed" from the head of 18. `prevOcrText` /
 * `nextOcrText` are the caller's promise of the pages adjacent to the block's ends.
 */
export function buildBlockTranslationPrompt({ prompts, book, pages, previousTranslation, prevOcrText, nextOcrText, pageBreak }) {
  const { prompt: header, promptRef, isEnglish } = translationPromptHeader({ prompts, book });
  const ocrOf = (p) => (typeof p.ocr === 'string' ? p.ocr : p.ocr?.data) || '';
  const adjacent = (a, b) => a?.page_number == null || b?.page_number == null || Number(a.page_number) + 1 === Number(b.page_number);
  const per = pages.map((p, i) => (pageBreak
    ? resolvePageBreakForPage({
      ocrText: ocrOf(p),
      prevOcrText: i > 0 ? (adjacent(pages[i - 1], p) ? ocrOf(pages[i - 1]) : undefined) : prevOcrText,
      nextOcrText: i + 1 < pages.length ? (adjacent(p, pages[i + 1]) ? ocrOf(pages[i + 1]) : undefined) : nextOcrText,
      pageBreak: { ...pageBreak, lookahead: false },
    })
    : null));
  const applied = !!pageBreak && (!pageBreak.scoped || per.some((r) => r.fired));

  let prompt = header;
  prompt += continuityContext(previousTranslation, { english: isEnglish });
  if (applied && pageBreak.rule) prompt += `\n\n${PAGE_BREAK_RULE}`;

  const verb = isEnglish ? 'modernize' : 'translate';
  prompt += `\n\n**IMPORTANT: You will receive ${pages.length} consecutive pages. ${isEnglish ? 'Modernize' : 'Translate'} each one separately. Wrap each translation in XML tags with the page number:**\n`;
  prompt += `\`\`\`\n${pages.map((p) => `<translation page="${p.page_number}">...${verb}d text...</translation>`).join('\n')}\n\`\`\`\n`;
  prompt += `\n**Pages to ${verb}:**\n`;
  pages.forEach((p, i) => {
    prompt += `\n--- Page ${p.page_number} ---\n${applied ? per[i].text : ocrOf(p)}\n`;
    if (applied && per[i].notes.length) prompt += `**At the page break:** ${per[i].notes.join(' ')}\n`;
  });

  return { prompt, promptRef, isEnglish, pageBreak: pageBreak ? { applied, pages: per.map((r) => ({ ...r.meta, fired: r.fired })) } : null };
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
/**
 * HTML whitespace entities, collapsed to a space before anything is measured.
 *
 * `&nbsp;` is six characters that carry no text, and OCR of a blank or lightly
 * ruled leaf is often made almost entirely of them. Until 2026-09-21 every length
 * check here counted them: page 170 of Kircher's *Iter extaticum II* measured
 * **18,561 characters of body** and, once decoded, held **nine** — a folio number.
 * `isBlankFromOcr`, `isDegenerateSource` and `isTranslatablePage` all passed it, the
 * page went to the translator as a substantial source, and the model filled the
 * vacuum with a fabricated 2011 nephrology journal table of contents that shipped to
 * readers and was one deposit away from a permanent DOI (#4960).
 *
 * The loop guard cannot catch this: `&nbsp;` padding was explicitly tuned OUT of the
 * repeat metric as a false positive (164 of 181 cases). Stripping apparatus so a
 * metric is not fooled by it, and then never asking whether anything REMAINS, is the
 * gap this closes.
 */
const WS_ENTITY = /&(?:nbsp|ensp|emsp|thinsp|hairsp|#0*160|#[xX]0*a0|#8194|#8195|#8201);/g;

/** Decode the few entities that are text, so they count as one character, not six. */
const TEXT_ENTITIES = [[/&amp;/g, '&'], [/&lt;/g, '<'], [/&gt;/g, '>'], [/&quot;/g, '"'], [/&#0*39;|&apos;/g, "'"]];

/**
 * Leader dots and rules: an index or table page can be mostly `....................`,
 * which is typography, not words. Four or more of the same punctuation mark in a row
 * collapse to one — four rather than three so a normal ellipsis survives untouched.
 * Same apparatus class as the entities above: strip it before measuring, then ask
 * whether anything is left.
 */
const LEADER_RUN = /([.\u00b7\u2022\u2024\u2027_\-–—=~*])\1{3,}/g;

export function bodyLen(text) {
  if (!text) return 0;
  let out = String(text).replace(blockRe, ' ').replace(looseRe, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/->|<-/g, ' ')
    .replace(WS_ENTITY, ' ')
    .replace(LEADER_RUN, ' ');
  for (const [re, ch] of TEXT_ENTITIES) out = out.replace(re, ch);
  return out.replace(/\s+/g, ' ').trim().length;
}

/**
 * Characters of real body below which a page has nothing to translate.
 *
 * Deliberately low. The asymmetry decides it: refusing a genuinely short page costs
 * an untranslated chapter heading, which is visible and recoverable; translating an
 * empty one costs a fabrication that is fluent, plausible and indistinguishable
 * downstream from a real translation. Missing is recoverable; invented is not.
 */
export const MIN_TRANSLATABLE_BODY = 24;

/**
 * Length of an illustration description the page carries instead of text.
 *
 * `<image-desc>` is in BLOCK_TAGS, so `bodyLen` strips it — which is right for asking
 * "how much transcription is here" and wrong for asking "is there anything to work
 * from". An illustration leaf has no words on it by definition, and the translate lane
 * legitimately turns its description into the `<note>` a reader sees:
 *
 *   "An engraving within a rectangular border depicts two men in 17th-century attire
 *    engaged in a wrestling match…"
 *
 * A no-body gate that ignored this would have silently stopped image descriptions
 * across the corpus — found by sampling real pages before shipping the gate, not by
 * reasoning about it.
 */
export function imageDescLen(text) {
  if (!text) return 0;
  let total = 0;
  for (const m of String(text).matchAll(/<image-desc\b[^>]*>([\s\S]*?)<\/image-desc>/gi)) {
    total += m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
  }
  return total;
}

/** Page types whose content is a picture, not words. */
const PICTORIAL_TYPES = new Set(['illustration', 'diagram', 'plate', 'map', 'frontispiece', 'portrait']);

/**
 * Has this page ANYTHING a translator can work from — words, or a picture described?
 * The vacuum is the absence of both.
 */
export function hasTranslatableSource(page) {
  const ocr = typeof page === 'string' ? page : page?.ocr?.data;
  if (bodyLen(ocr) >= MIN_TRANSLATABLE_BODY) return true;
  if (imageDescLen(ocr) >= MIN_TRANSLATABLE_BODY) return true;
  const type = typeof page === 'string' ? null : page?.page_type;
  // A pictorial page with a real description already returned true above; one with
  // neither words nor a description has nothing, whatever its type claims.
  if (type && PICTORIAL_TYPES.has(type) && imageDescLen(ocr) > 0) return true;
  return false;
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
 *
 * Three refusals. `collapsed` and `runaway` need only the two texts. `echo` — the "translation"
 * is the source reproduced (#5103 round 4: flash-lite completed an oath from the next page and
 * then handed page 68's Latin back as its translation; the 2026-08 batch-lane repair echoed a
 * garbled index page) — needs the BOOK's language, because an English source is modernised, not
 * translated, and shares runs with its "translation" by design. Pass `{ lang }` to arm that tier;
 * without it the echo tier is skipped, never guessed (page-integrity `echoedSource`, wholePage:
 * the shared run is at least half the translation's prose).
 *
 * @returns {{healthy: boolean, reason: 'collapsed'|'runaway'|'echo'|null}}
 */
export function assessTranslationHealth(ocrText, translationText, { lang } = {}) {
  if (isCollapsed(ocrText, translationText)) return { healthy: false, reason: 'collapsed' };
  if (isExcess(ocrText, translationText)) return { healthy: false, reason: 'runaway' };
  if (lang) {
    const e = echoedSource({ ocr: ocrText, tr: translationText, lang });
    if (e.judged && e.wholePage) return { healthy: false, reason: 'echo' };
  }
  return { healthy: true, reason: null };
}

/**
 * Parse a block response (`<translation page="N">…</translation>` per page) as the worker does —
 * moved here from translate-worker.mjs (2026-09-25) so the shape can be tested and the
 * Batch-lane harness stops carrying its own copy.
 *
 * The block-shift guard (#5103 round 4): a block that comes back with FEWER entries than pages
 * sent is discarded whole. Measured on a real block (pp. 6–13 of the Apologia, EXPERIMENTS.md
 * "2026-09-25 (round 4)"): the model dropped page 13 and labelled page 9's text
 * `<translation page="8">`, and so on down the block — seven correctly-formed entries, every
 * one on the wrong page. Labels on a short block cannot be trusted, and the caller's
 * missing-from-batch path re-translates every page single-page. Production logs 2026-09-11 →
 * 09-25: ~5% of blocks came back short (473 of ~9,400, the drift drops aside).
 *
 * @returns {{ translations: Map<number,string>, returned: number, discarded: null|'short-block' }}
 */
export function parseBlockTranslations(responseText, pages) {
  const translations = new Map();
  const regex = /<translation\s+page="(\d+)">([\s\S]*?)<\/translation>/g;
  const ocrOf = (p) => (typeof p.ocr === 'string' ? p.ocr : p.ocr?.data) || '';
  // A translation under 15% of its OCR is a truncation (a stray closing tag) — the page falls back.
  const tooShort = (p, text) => p && ocrOf(p).length > 100 && text.length < ocrOf(p).length * 0.15;
  const entries = []; // in order, for the positional fallback
  let match;
  while ((match = regex.exec(responseText || '')) !== null) {
    const pageNum = parseInt(match[1], 10);
    const text = sanitizeTranslationTags(match[2].trim());
    entries.push(text);
    if (tooShort(pages.find((p) => p.page_number === pageNum), text)) continue;
    translations.set(pageNum, text);
  }
  if (entries.length < pages.length) return { translations: new Map(), returned: entries.length, discarded: 'short-block' };
  // Positional fallback: the model renumbered the pages (1–8 for 491–498); the count matches, so
  // the order is trusted and each entry is checked against its own page's length.
  if (entries.length === pages.length && pages.filter((p) => translations.has(p.page_number)).length < pages.length) {
    translations.clear();
    pages.forEach((p, i) => { if (!tooShort(p, entries[i])) translations.set(p.page_number, entries[i]); });
  }
  return { translations, returned: entries.length, discarded: null };
}

// Refused output is stored truncated — a 350K-char loop is evidence of a loop,
// not 350K chars of evidence. Original length is recorded alongside.
const REFUSED_TEXT_CAP = 50000;

/**
 * Persist health-gate-refused output to page_revisions as evidence (#3826).
 *
 * The 2026-08-08 incident refused 5,352 generations and kept none of them:
 * each cost real money (runaways bill 10-40× a normal page) and was reduced
 * to a boolean flag. Keeping the text costs ~nothing and buys loop-detector
 * tuning data, salvageable prefixes, and honest accounting. The row carries
 * `source: 'health-gate-refused'` — page_revisions is ALWAYS segmented by
 * source before measurement (data-provenance doc), so these rows can never
 * contaminate the OCR-agreement corpus.
 *
 * Never throws; evidence loss must not block the refusal itself.
 */
export async function persistRefusedTranslation(db, page, text, reason, { jobId, model } = {}) {
  try {
    const raw = text || '';
    await db.collection('page_revisions').insertOne({
      id: randomBytes(6).toString('hex'),
      page_id: page.id,
      book_id: page.book_id,
      field: 'translation',
      data: raw.slice(0, REFUSED_TEXT_CAP),
      source: 'health-gate-refused',
      reason,
      original_length: raw.length,
      truncated: raw.length > REFUSED_TEXT_CAP,
      model,
      job_id: jobId,
      created_at: new Date(),
    });
  } catch (e) {
    console.error(`[health-gate] Failed to persist refused output for ${page?.id}: ${e.message?.slice(0, 80)}`);
  }
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
 *
 * `digitizer-insert` added #4685/#4507: this lane should stop attempting pages the
 * meter (page-counts.mjs NEVER_TRANSLATED_PAGE_TYPES) no longer counts as translatable.
 */
export const SKIP_TRANSLATION_PAGE_TYPES = ['blank', 'exlibris', 'bookplate', 'digitizer-notice', 'digitizer-insert'];

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
 * Is this page's SOURCE TEXT a degeneration loop (#4850)?
 *
 * The reason this belongs on the translation side as well as the OCR side: every
 * fabrication the blind judge found in the #4759 read came from a looping input
 * (#4765). Handed a page of one syllable repeated 3,000 times, the model does not
 * decline — it writes fluent connected prose with no basis in the page, and the
 * result is indistinguishable downstream from a real translation. The OCR gate stops
 * NEW loops being stored; this stops the 69,223 already in the corpus (measured
 * 2026-09-15) from being turned into prose.
 *
 * Pre-flight, so the call is never billed.
 */
export function isDegenerateSource(ocrText) {
  return loopVerdict(ocrText || '').refuse;
}

/** The reason value stamped on `translation.health_blocked` for a looping source. */
export const SOURCE_LOOP_REASON = 'source_loop';

/**
 * THE translatability check. Returns { ok, reason } so callers can count and
 * log why pages were excluded rather than silently dropping them.
 *
 * Reasons: 'soft-hidden' (page_number <= 0 — never renders, #3293),
 * 'skip-type', 'no-ocr', 'ocr-unreadable', 'blank-ocr', 'no-body', 'ocr-loop',
 * 'recitation-blocked', 'safety-blocked'.
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
  // `ocr.unreadable` keeps `data` for provenance but the page has no transcription we trust
  // (#4523); translating it only makes work for the stale-translation sweep, which withholds
  // the result an hour later. Same rule as page-counts.hasOcr.
  if (page?.ocr?.unreadable === true) return { ok: false, reason: 'ocr-unreadable' };
  if (isBlankFromOcr(ocr)) return { ok: false, reason: 'blank-ocr' };
  // Nothing to translate once the apparatus is discounted. A model handed an empty
  // source does not decline — it invents (#4960), and the invention reads exactly
  // like a translation. Checked BEFORE the loop test because a page of `&nbsp;` is
  // not a loop; it is a vacuum.
  if (!hasTranslatableSource(page)) return { ok: false, reason: 'no-body' };
  // A looping transcription is not a text to translate — it is the input that
  // produces a fabricated translation (#4765/#4850).
  if (isDegenerateSource(ocr)) return { ok: false, reason: 'ocr-loop' };
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
    'ocr.unreadable': { $ne: true },
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
  // or runaway translation to pages. The refused text IS kept as evidence in
  // page_revisions (source: 'health-gate-refused', #3826) — it cost real money
  // and tunes the detector; only the reader-facing write is refused.
  if (refuseUnhealthy) {
    const health = assessTranslationHealth(page?.ocr?.data, clean, { lang: book?.language });
    if (!health.healthy) {
      await persistRefusedTranslation(db, page, clean, health.reason, { jobId, model });
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
      // A new translation is the exit from the stale marker (#4927).
      $unset: CLEAR_STALE_UNSET,
    }
  );
  return { written: true, protected: false, text: clean };
}

/**
 * Bulk form of the human-edit guard, for batch collectors that write many
 * pages at once: which of these pages have a human-edited `field`
 * ('translation' | 'ocr')? Returns the Set of protected page ids — batch
 * results for those pages must be skipped, not written. Same predicate as
 * writePageTranslation's guard (source 'manual' or edited_by set); manual
 * edits stamp the identical convention on both fields (/api/pages/[id]).
 * TS twin: findHumanEditedPageIds in src/lib/translate-write.ts.
 */
export async function findHumanEditedPageIds(db, pageIds, field = 'translation') {
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
  return new Set(docs.map(d => d.id));
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
