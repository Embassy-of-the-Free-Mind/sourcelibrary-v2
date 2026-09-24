#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-prompt-ab.mjs — the paired translation A/B this extends.
// Its Gemini caller, worker pool and per-page scorer (`gemini`, `pool`, `scoreTranslation`) are
// IMPORTED, not copied. It does not fit as-is because its unit is a single page and its estimand
// a note-verification rate; the only thing the Batch API loses is the seed handed across a BLOCK
// boundary, which a single-page draw cannot see. Statistics come from lib/paired-stats.mjs and the
// draw from lib/sampling.mjs (`sampleOnePagePerBook`). Also checked: scripts/eval/qa-eval.mjs (no
// arm concept), scripts/eval/prompt-ab.mjs (image-in OCR arms), and the 2026-09-13 model A/B
// (model arms, not context arms).
/** Paired three-arm A/B at the block boundary: does translation lose anything when the cross-block continuity seed is dropped (Batch API) or replaced with source text? */
/**
 * translation-batch-continuity-ab.mjs — does translation survive the Batch API?
 *
 * Design, hypotheses, margins and the decision rule are fixed in
 * scripts/eval/PREREGISTRATION-translation-batch-continuity.md. Read that first.
 *
 * ── What is being varied ───────────────────────────────────────────────────
 * Production translates in blocks of 8 pages, one prompt per block. After each
 * block the worker keeps the LAST page's fresh translation and prepends its
 * first 2,000 chars to the next block's prompt (translate-worker.mjs
 * `translateBatch`, and the `prevTranslation = translatedText` chain). Under the
 * Batch API every block is submitted at once, so that seed cannot exist.
 *
 *   A  chained         block k seeded with block k-1's last-page TRANSLATION   (production)
 *   B  unseeded        block k with no seed                                    (naive batch)
 *   C  source-seeded   block k seeded with block k-1's last-page OCR SOURCE    (batch-compatible)
 *
 * Block k-1 is translated once and shared by all three arms. The unit of
 * analysis is a BOUNDARY, one per book.
 *
 * ── The trap, and the two guards against it ────────────────────────────────
 * A boundary that is not a boundary (chapter break, plate, blank, empty OCR)
 * gives a perfect, meaningless agreement: every arm continues nothing.
 *   1. The draw keeps only seams where block k-1 ends MID-FLOW, and records every
 *      rejected candidate with its reason.
 *   2. The score prints a SHUFFLED control for H1: block k scored against the
 *      term list of a DIFFERENT book in the same language. If the real rate is
 *      not well above the shuffled one, the probe is inert and the null is void.
 *
 * ── Phases (only `run` costs money) ────────────────────────────────────────
 *   --draw          build + pin the boundary sample, print the cost estimate   FREE
 *   --run           block k-1 once, then block k under A, B and C              PAID
 *   --score         H1, H3, shuffled control, H2 if verdicts exist, the rule   FREE
 *   --judge-packet  blinded junction pairs (A/B and A/C) for the H2 judge      FREE
 *   --harness-control  does arm A reproduce production's stored output?     FREE
 *
 * NOTHING here writes to `pages`. The translate worker's write path is not
 * imported. The only writes are files under scripts/eval/results/ and usage rows
 * (endpoint `eval/translation-batch-continuity`) so the spend is attributable.
 *
 * Run on Hetzner (paid Gemini is geo-blocked on the laptop):
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/translation-batch-continuity-ab.mjs --draw
 *   node scripts/eval/translation-batch-continuity-ab.mjs --run --approved-usd 5
 *   node scripts/eval/translation-batch-continuity-ab.mjs --score
 *   node scripts/eval/translation-batch-continuity-ab.mjs --judge-packet
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseTranslationTerms, termKey } from '../lib/page-terms-parse.mjs';
import {
  loadTranslationPrompts, isEnglishBook, sanitizeTranslationTags, isTranslatablePage,
  translatablePageFilter, isDegenerateSource, MODEL_LITE,
} from '../lib/translate-core.mjs';
import { priceFor } from '../lib/model-pricing.mjs';
import { logUsage } from '../workers/lib/supabase-usage-logger.mjs';
import { sampleOnePagePerBook, connect, disconnect } from './lib/sampling.mjs';
import { diffCI, bootstrapCI, bootstrapRatioCI, binomTwoSided, resetSeed, seededRand, mean } from './lib/paired-stats.mjs';
import { gemini, pool, scoreTranslation } from './translation-prompt-ab.mjs';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const RESULTS = new URL('./results/', import.meta.url).pathname;
const SAMPLE_FILE = arg('sample', path.join(RESULTS, 'translation-batch-continuity-sample.json'));
const OUT_FILE = arg('out', path.join(RESULTS, 'translation-batch-continuity-arms.jsonl'));
const VERDICTS_FILE = path.join(RESULTS, 'translation-batch-continuity-judge-verdicts.json');
const KEY_FILE = path.join(RESULTS, 'translation-batch-continuity-judge-key.json');
const MODEL = MODEL_LITE;                 // fixed by the preregistration
const BLOCK = 8;                          // production BATCH_SIZE
const MAX_BLOCK_OCR_CHARS = 20000;        // production MAX_BATCH_OCR_CHARS — a bigger block is never sent as 8
const MIN_PAGE_OCR_CHARS = 200;           // production MIN_OCR_CHARS_FOR_BATCH — a shorter page ends the block
const SEED_CHARS = 2000;                  // production seed slice
// --tail: the seed is the END of the previous page, as production sends it since
// PR #4970 (#4968: from 2025-12-12 to 2026-09-22 production — and arms A and E
// here — sent the FIRST 2,000 chars, so the seam was the part never seen).
// Arms At and Et are A and E with that fix; prev and B are shared unchanged.
const TAIL = has('tail');
// --hybrid: arm Ah — the previous page's <summary>/<keywords> KEPT (the head seed
// carried them on short pages and the judge preferred it, PR #4912 comment
// 2026-09-22), the first HEAD_CHARS for the page's conventions, the last
// TAIL_CHARS for the seam, production's original label and trailing '...'.
// Identical to A when the page fits in SEED_CHARS.
const HYBRID = has('hybrid');
const HEAD_CHARS = 600, TAIL_CHARS = 1400;
export function seedHybrid(text) {
  const raw = String(text);
  const blocks = (raw.match(/<(summary|keywords)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || []).join('\n');
  const body = raw.replace(/<(meta|summary|keywords|vocab|warning)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '').trim();
  const core = body.length <= SEED_CHARS ? body : `${body.slice(0, HEAD_CHARS)}\n[…]\n${body.slice(-TAIL_CHARS)}`;
  return `${core}${blocks ? `\n${blocks}` : ''}...`;
}
/** Mirrors continuityContext() in translate-core (PR #4970): editorial blocks off, last SEED_CHARS, '...' in front. */
export function seedSlice(text, tail = TAIL) {
  if (!tail) return `${text.slice(0, SEED_CHARS)}...`;
  const body = String(text).replace(/<(meta|summary|keywords|vocab|warning)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '').trim();
  return body.length > SEED_CHARS ? `...${body.slice(-SEED_CHARS)}` : body;
}
const CEILING_USD = 5;                    // the preregistered hard ceiling
const ENDPOINT = 'eval/translation-batch-continuity';
const CONCURRENCY = Number(arg('concurrency', 4));
const ARMS = ['A', 'B', 'C'];

/**
 * n = 60, allocated in proportion to pages production ACTUALLY translated
 * 2026-09-01..17 (104,008 pages, endpoint worker/hetzner-translate-batch), largest
 * remainder, every language at or above 1% kept. See the dated amendment in the
 * preregistration for why this is the throughput mix and not the instantaneous
 * queue (the dial keeps the queue drained: it held 22 books when measured).
 */
const ALLOCATION = {
  English: 23, Latin: 16, Chinese: 6, Arabic: 4, French: 2, Hebrew: 2, German: 2,
  Spanish: 1, Dutch: 1, Tibetan: 1, Greek: 1, Malay: 1,
};

// ── the seam filter ─────────────────────────────────────────────────────────
const NON_PROSE_TYPES = new Set(['index', 'toc', 'title-page', 'illustration', 'blank', 'errata', 'diagram',
  'frontispiece', 'colophon', 'map', 'archived-spread', 'digitizer-insert', 'digitizer-notice', 'exlibris', 'bookplate']);
const OCR_WRAPPERS = 'meta|vocab|language|lang|page-type|page-num|sig|scan-quality|script|columns|header|image-desc|folio|detected-images|catchword|warning';

/** OCR page text with housekeeping removed: what a reader would call the prose. */
export function ocrProse(ocr) {
  return (ocr || '')
    .replace(new RegExp(`<(${OCR_WRAPPERS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

const TERMINATOR_RE = /(?:\bfinis\b|\bexplicit\b|\bthe end\b|\bend of (?:the )?(?:book|chapter|part|volume)\b|\bfin\b|\bende\b|\bfine\b|\bamen\b|laus deo|τέλος|تمت|تم الكتاب|終|完)[\s.:!*·—-]*$/iu;
const HEADING_RE = /^(?:#{1,6}\s|(?:chapter|chap\.|caput|cap\.|liber|book|part|section|sectio|kapitel|chapitre|capitulo|capítulo|hoofdstuk|the\s+\w+\s+(?:chapter|book))\b|第.{1,5}[章卷回篇]|الباب|الفصل|باب|فصل)/iu;
const SENTENCE_END_RE = /[.!?;:。！？；：।॥།༎׃۔”"’')\]»]$/u;

/**
 * Is this a real mid-flow seam? `last` is the last page of block k-1, `first` the
 * first page of block k. Returns { ok, reason, midSentence }.
 */
export function assessSeam(last, first) {
  const a = ocrProse(last?.ocr?.data), b = ocrProse(first?.ocr?.data);
  if (NON_PROSE_TYPES.has(last?.page_type) || NON_PROSE_TYPES.has(first?.page_type)) return { ok: false, reason: 'seam page is not prose (page_type)' };
  if (a.length < 400 || b.length < 400) return { ok: false, reason: 'seam page has under 400 chars of prose' };
  if (TERMINATOR_RE.test(a.slice(-80))) return { ok: false, reason: 'block k-1 ends at a section terminator' };
  const firstLine = b.split('\n').find((l) => l.trim().length > 0)?.trim() || '';
  if (HEADING_RE.test(firstLine)) return { ok: false, reason: 'block k opens with a heading' };
  const letters = firstLine.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 4 && firstLine.length <= 60 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return { ok: false, reason: 'block k opens with a heading' };
  return { ok: true, reason: null, midSentence: !SENTENCE_END_RE.test(a) };
}

// ── prompt construction: the worker's translateBatch, minus everything that writes ──
const bookOf = (r) => ({ id: r.bookId, title: r.bookTitle, display_title: r.bookTitle, author: r.author, published: r.year, language: r.language });

/** Mirrors translate-worker.mjs buildPromptHeader(). */
function promptHeader(prompts, book) {
  const english = isEnglishBook(book);
  const base = english ? prompts.english : prompts.translation;
  let prompt = base.text.replace('{source_language}', book.language || 'Latin');
  const parts = [];
  if (book.display_title || book.title) parts.push(`Title: ${book.display_title || book.title}`);
  if (book.author) parts.push(`Author: ${book.author}`);
  if (book.year || book.published) parts.push(`Date: ${book.year || book.published}`);
  if (parts.length) prompt += `\n\n**Source work:** ${parts.join(' | ')}`;
  const year = parseInt(book.year || book.published, 10);
  if (year && year < 1930) prompt += `\n\n**Note:** This is a public domain work published in ${year}. It is not under copyright.`;
  return { prompt, english, ref: base.ref };
}

/**
 * Mirrors translate-worker.mjs translateBatch() prompt assembly. `seed` is
 * { kind: 'translation' | 'source', text } or null. The 'translation' wording is
 * production's, byte for byte; 'source' is arm C's and differs only in its label.
 */
export function blockPrompt(prompts, book, pages, seed) {
  const { prompt: header, english, ref } = promptHeader(prompts, book);
  let prompt = header;
  if (seed?.text) {
    if (seed.kind === 'source') prompt += `\n\n**Previous page (untranslated source text) for continuity:**\n${seed.text.slice(0, SEED_CHARS)}...`;
    else if (HYBRID) prompt += english
      ? `\n\n**Previous page (modernized) for continuity:**\n${seedHybrid(seed.text)}`
      : `\n\n**Previous page translation for continuity:**\n${seedHybrid(seed.text)}`;
    else if (TAIL) prompt += english
      ? `\n\n**Previous page (modernized) for continuity — continue from its end:**\n${seedSlice(seed.text)}`
      : `\n\n**Previous page translation for continuity — continue from its end:**\n${seedSlice(seed.text)}`;
    else prompt += english
      ? `\n\n**Previous page (modernized) for continuity:**\n${seed.text.slice(0, SEED_CHARS)}...`
      : `\n\n**Previous page translation for continuity:**\n${seed.text.slice(0, SEED_CHARS)}...`;
  }
  const verb = english ? 'modernize' : 'translate';
  prompt += `\n\n**IMPORTANT: You will receive ${pages.length} consecutive pages. ${english ? 'Modernize' : 'Translate'} each one separately. Wrap each translation in XML tags with the page number:**\n`;
  prompt += `\`\`\`\n${pages.map((p) => `<translation page="${p.page_number}">...${verb}d text...</translation>`).join('\n')}\n\`\`\`\n`;
  prompt += `\n**Pages to ${verb}:**\n`;
  for (const p of pages) prompt += `\n--- Page ${p.page_number} ---\n${p.ocr}\n`;
  return { prompt, ref };
}

/**
 * Arm E's prompt. The pass sees the previous page's translation (the same 2,000-char slice arm A
 * is seeded with), the SOURCE of the seam page so that it has something to verify against, and
 * the unseeded translation it is to repair. It is told to change as little as possible.
 */
export function seamRepairPrompt(book, prevTranslation, ocr, draft) {
  return `You are revising one page of an English translation of a ${book.language || 'Latin'} book so that it continues seamlessly from the page before it. The page was translated without sight of the previous page.

Change ONLY what continuity requires: a sentence carried over the page break that was picked up wrongly, a name or technical term rendered differently from the previous page, a formatting convention (headers, notes, markup) that differs from the previous page. Change NOTHING else. Do not improve, shorten or expand the translation. Do not add anything that is not in the source text. Keep all markup tags exactly as they are. If nothing needs changing, return the page unchanged.

Return the full revised page and nothing else.

**Previous page translation${TAIL ? ' (its end)' : ''}:**
${seedSlice(prevTranslation)}

**Source text of this page:**
${ocr}

**Translation of this page, to revise:**
${draft}`;
}

/** Mirrors the worker's response parse, including the 15%-length reject and the positional fallback. */
export function parseBlock(responseText, pages) {
  const out = new Map();
  const entries = [];
  const re = /<translation\s+page="(\d+)">([\s\S]*?)<\/translation>/g;
  let m;
  const tooShort = (p, text) => p && p.ocr.length > 100 && text.length < p.ocr.length * 0.15;
  while ((m = re.exec(responseText || '')) !== null) {
    const n = parseInt(m[1], 10);
    const text = sanitizeTranslationTags(m[2].trim());
    entries.push(text);
    if (tooShort(pages.find((p) => p.page_number === n), text)) continue;
    out.set(n, text);
  }
  if (entries.length === pages.length && entries.length > 0 && pages.filter((p) => out.has(p.page_number)).length < pages.length) {
    out.clear();
    pages.forEach((p, i) => { if (!tooShort(p, entries[i])) out.set(p.page_number, entries[i]); });
  }
  return out;
}

const maxOutFor = (pages) => Math.min(32768, Math.max(4096, Math.ceil(pages.reduce((n, p) => n + p.ocr.length, 0)) + 1200 * pages.length));

// ── H1: cross-boundary terminology consistency ──────────────────────────────
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with', 'by', 'from', 'as', 'at', 'that', 'this', 'is', 'are', 'be', 'it', 'its', 'one', 'who', 'which', 'literally', 'lit', 'i.e', 'ie', 'eg']);
const fold = (s) => termKey(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
const contentWords = (s) => fold(s).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));

/**
 * The terms block k-1 committed to: every <term> it tagged, with the renderings
 * it used. A rendering candidate is each "/"- or ";"-separated alternative of the
 * gloss, and, when there is no gloss (names, mostly), the term as kept.
 */
export function committedTerms(prevTranslations) {
  const byKey = new Map();
  for (const text of prevTranslations) {
    for (const row of parseTranslationTerms(text, null)) {
      if (row.kind !== 'term') continue;
      const key = termKey(row.term);
      if (!key || key.length < 3) continue;
      const cands = (row.gloss ? row.gloss.split(/[\/;]| or /i) : [row.term]).map(contentWords).filter((w) => w.length > 0 && w.length <= 6);
      if (!cands.length) continue;
      if (!byKey.has(key)) byKey.set(key, { term: row.term, key, renderings: [] });
      byKey.get(key).renderings.push(...cands);
    }
  }
  return [...byKey.values()];
}

/**
 * H1 for one boundary and one arm. Eligible terms are those block k-1 committed
 * to whose SOURCE FORM recurs in block k's OCR — so the denominator depends only
 * on the shared block and the source, never on the arm. A term is consistent when
 * block k's translation contains every content word of at least one rendering
 * block k-1 used.
 */
export function terminologyConsistency(terms, blockOcr, blockTranslation) {
  const src = termKey(ocrProse(blockOcr));
  const words = new Set(fold(blockTranslation).split(' '));
  const eligible = terms.filter((t) => src.includes(t.key));
  const hit = eligible.filter((t) => t.renderings.some((r) => r.every((w) => words.has(w))));
  return { eligible: eligible.length, consistent: hit.length, rate: eligible.length ? hit.length / eligible.length : null };
}

// ── phase: draw ─────────────────────────────────────────────────────────────
async function phaseDraw() {
  const { db } = await connect();
  const pageFilter = translatablePageFilter();
  const sample = [];
  const rejected = {};
  const reject = (why) => { rejected[why] = (rejected[why] || 0) + 1; };
  const seen = new Set();

  for (const [language, want] of Object.entries(ALLOCATION)) {
    let got = 0;
    for (let round = 0; round < 6 && got < want; round++) {
      // The sampled page is the candidate SEAM: the last page of block k-1.
      const anchors = await sampleOnePagePerBook({
        bookFilter: { language, pages_ocr: { $gte: 2 * BLOCK + 4 }, 'image_source.provider': { $ne: 'bph' }, 'pipeline_auto.hold': { $exists: false } },
        pageFilter: { ...pageFilter, page_number: { $gte: BLOCK } },
        n: (want - got) * 4, minOcrChars: 400, oversample: 2,
      });
      for (const a of anchors) {
        if (got >= want) break;
        if (seen.has(a.bookId)) continue;
        seen.add(a.bookId);
        const lo = a.pageNumber - BLOCK + 1, hi = a.pageNumber + BLOCK;
        const pages = await db.collection('pages')
          .find({ book_id: a.bookId, page_number: { $gte: lo, $lte: hi } }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.unreadable': 1, 'translation.recitation_blocked': 1, 'translation.safety_blocked': 1 } })
          .sort({ page_number: 1 }).toArray();
        const byNum = new Map(pages.map((p) => [p.page_number, p]));
        const window = [];
        for (let n = lo; n <= hi; n++) window.push(byNum.get(n));
        if (window.some((p) => !p)) { reject('window runs off the book or has a missing page'); continue; }
        if (window.some((p) => !isTranslatablePage(p).ok)) { reject('a page in the window is not translatable'); continue; }
        if (window.some((p) => (p.ocr?.data || '').length < MIN_PAGE_OCR_CHARS)) { reject(`a page is under ${MIN_PAGE_OCR_CHARS} OCR chars (production would end the block there)`); continue; }
        if (window.some((p) => isDegenerateSource(p.ocr?.data))) { reject('a page is a degenerate OCR loop'); continue; }
        const prev = window.slice(0, BLOCK), next = window.slice(BLOCK);
        const chars = (ps) => ps.reduce((s, p) => s + p.ocr.data.length, 0);
        if (chars(prev) > MAX_BLOCK_OCR_CHARS || chars(next) > MAX_BLOCK_OCR_CHARS) { reject(`a block exceeds ${MAX_BLOCK_OCR_CHARS} OCR chars (production would not send it as 8)`); continue; }
        const seam = assessSeam(prev[BLOCK - 1], next[0]);
        if (!seam.ok) { reject(seam.reason); continue; }
        // The seed for the FIRST block of a run comes from the database and survives batch; carry it read-only.
        const before = await db.collection('pages').findOne({ book_id: a.bookId, page_number: lo - 1, 'translation.data': { $exists: true } }, { projection: { 'translation.data': 1 } });
        const strip = (p) => ({ id: p.id, page_number: p.page_number, page_type: p.page_type || null, ocr: p.ocr.data });
        sample.push({
          bookId: a.bookId, bookTitle: a.bookTitle, author: a.author, year: a.year, language: a.language, provider: a.provider,
          seamPage: a.pageNumber, midSentence: seam.midSentence,
          dbSeed: typeof before?.translation?.data === 'string' ? before.translation.data.slice(0, SEED_CHARS) : null,
          prev: prev.map(strip), next: next.map(strip),
          ocrChars: chars(prev) + chars(next),
        });
        got++;
      }
    }
    console.log(`${language.padEnd(10)} drew ${String(got).padStart(2)}/${want}${got < want ? '   (stratum exhausted — reported, not silently padded)' : ''}`);
  }

  if (new Set(sample.map((r) => r.bookId)).size !== sample.length) throw new Error('draw is not one-boundary-per-book');
  const est = estimate(sample);
  const nRejected = Object.values(rejected).reduce((s, x) => s + x, 0);
  const payload = {
    drawn_at: new Date().toISOString(), model: MODEL, block: BLOCK, arms: ARMS, allocation: ALLOCATION,
    n_boundaries: sample.length, mid_sentence: sample.filter((r) => r.midSentence).length,
    candidates_rejected: nRejected, rejected, estimate: est, sample,
  };
  fs.mkdirSync(path.dirname(SAMPLE_FILE), { recursive: true });
  fs.writeFileSync(SAMPLE_FILE, JSON.stringify(payload, null, 1));
  console.log(`\nn = ${sample.length} boundaries, one per book; ${payload.mid_sentence} end mid-sentence`);
  console.log(`candidate seams rejected: ${nRejected}`);
  for (const [why, n] of Object.entries(rejected).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${why}`);
  console.log(`\nESTIMATE: ${est.calls} calls, in ~${est.inputTokens.toLocaleString()} tok, out ~${est.outputTokens.toLocaleString()} tok = $${est.usd.toFixed(2)}  (ceiling $${CEILING_USD})`);
  console.log(`wrote ${SAMPLE_FILE}\nPAID STEP NOT RUN.`);
}

/** 4 block calls per boundary (k-1 once, k three times), priced from the drawn OCR chars. */
function estimate(sample, promptChars = 7600) {
  const price = priceFor(MODEL);
  let inputTokens = 0, outputTokens = 0;
  for (const r of sample) {
    const c = (ps) => ps.reduce((s, p) => s + p.ocr.length, 0);
    inputTokens += Math.ceil((promptChars + c(r.prev) + SEED_CHARS) / 4) + 3 * Math.ceil((promptChars + c(r.next) + SEED_CHARS) / 4);
    outputTokens += Math.ceil(c(r.prev) * 0.35) + 3 * Math.ceil(c(r.next) * 0.35);
  }
  return { calls: sample.length * 4, inputTokens, outputTokens, usd: (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output };
}

// ── phase: run (PAID) ───────────────────────────────────────────────────────
function readRows() {
  if (!fs.existsSync(OUT_FILE)) return [];
  const rows = [];
  for (const line of fs.readFileSync(OUT_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn final line from a killed run */ }
  }
  return rows;
}

async function phaseRun() {
  const payload = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));
  const est = estimate(payload.sample);
  // --tail: one block call (At) and one repair call (Et) per boundary, prev and B reused
  if (HYBRID) est.usd = est.usd / 4;
  if (TAIL || HYBRID) {
    if (TAIL) est.usd = est.usd / 4 * 1.15;
    if (arg('pin-english') == null) { console.error('REFUSING: --tail without --pin-english — the original arms ran on English Modernization v1 and the default is now v2 (23 English boundaries would be confounded).'); process.exit(2); }
  }
  const approved = Number(arg('approved-usd', 0));
  if (!(approved >= est.usd) || approved > CEILING_USD || est.usd > CEILING_USD) {
    console.error(`REFUSING TO SPEND. Estimate $${est.usd.toFixed(2)}; --approved-usd is ${approved || 'absent'}; preregistered ceiling $${CEILING_USD}.`);
    process.exit(2);
  }
  if (has('with-d')) {
    const already = readRows().reduce((t, x) => t + (x.cost_usd || 0), 0);
    const dEst = est.usd / 4 * 1.125;
    console.log(`arm D: ~$${dEst.toFixed(2)} more on top of $${already.toFixed(2)} already spent`);
    if (already + dEst > CEILING_USD) { console.error('REFUSING: arm D would pass the ceiling.'); process.exit(2); }
  }
  const { db } = await connect();
  const prompts = await loadTranslationPrompts(db);
  // --pin-english N / --pin-translation N: run with an older prompt version, so a re-run
  // of some arms is compared like with like. The original arms (2026-09-17) used
  // Standard Translation v13 and English Modernization v1; v2 of the latter was
  // created 2026-09-21 and is now the default.
  for (const [flag, key, type] of [['pin-english', 'english', 'english_modernization'], ['pin-translation', 'translation', 'translation']]) {
    const v = arg(flag);
    if (v == null) continue;
    const doc = await db.collection('prompts').findOne({ type, version: Number(v) });
    if (!doc?.content) throw new Error(`--${flag} ${v}: no '${type}' prompt with that version`);
    prompts[key] = { text: doc.content, ref: { id: doc._id?.toString(), name: doc.name, version: doc.version, content_hash: doc.content_hash } };
  }
  console.log(`prompt: ${prompts.translation.ref.name} v${prompts.translation.ref.version}; english: ${prompts.english.ref.name} v${prompts.english.ref.version}; model ${MODEL}`);

  const price = priceFor(MODEL);
  // Under --tail only the new arms count against the approval; the original run's
  // rows are on disk too, and counting them made every call skip as over budget.
  const countsHere = (r) => (TAIL ? r.which === 'At' || r.which === 'Et' : HYBRID ? r.which === 'Ah' : true);
  let spent = readRows().filter(countsHere).reduce((s, r) => s + (r.cost_usd || 0), 0);
  if (spent) console.log(`resuming: $${spent.toFixed(3)} already spent on disk`);
  const stream = fs.createWriteStream(OUT_FILE, { flags: 'a' });

  /** One block call. Logs usage to the meter; writes the row; never touches `pages`. */
  const callBlock = async (r, which, pages, seed) => {
    if (spent >= approved) return { skipped: 'spend reached --approved-usd' };
    const { prompt, ref } = blockPrompt(prompts, bookOf(r), pages, seed);
    const t0 = Date.now();
    let res = await gemini(prompt, maxOutFor(pages), MODEL);
    let parsed = res.error ? new Map() : parseBlock(res.text, pages);
    let cost = res.error ? 0 : (res.inTok / 1e6) * price.input + (res.outTok / 1e6) * price.output;
    const log = (rr, c, n) => logUsage({
      type: 'translation', mode: 'realtime', model: MODEL, book_id: r.bookId, page_count: pages.length,
      input_tokens: rr.inTok || 0, output_tokens: rr.outTok || 0, cost_usd: c,
      status: rr.error ? 'error' : n < pages.length ? 'partial' : 'success', error_message: rr.error || null,
      duration_ms: Date.now() - t0, prompt_version: `v${ref.version}`, endpoint: ENDPOINT, triggered_by: 'manual',
    }, db).catch((e) => console.warn(`usage log failed: ${e.message}`));
    await log(res, cost, parsed.size);
    // One retry when the seam page itself did not come back: without it the boundary is unusable.
    const seamPage = which === 'prev' ? pages[pages.length - 1].page_number : which === 'D' ? pages[1].page_number : pages[0].page_number;
    let retried = false;
    if (!parsed.has(seamPage) && spent + cost < approved) {
      retried = true;
      const res2 = await gemini(prompt, maxOutFor(pages), MODEL);
      const parsed2 = res2.error ? new Map() : parseBlock(res2.text, pages);
      const cost2 = res2.error ? 0 : (res2.inTok / 1e6) * price.input + (res2.outTok / 1e6) * price.output;
      await log(res2, cost2, parsed2.size);
      cost += cost2;
      if (parsed2.size > parsed.size) { res = res2; parsed = parsed2; }
    }
    spent += cost;
    if (which === 'D') parsed.delete(pages[0].page_number);   // the overlap page is translated and thrown away
    const row = {
      bookId: r.bookId, language: r.language, which, seamPage: r.seamPage, model: MODEL,
      seedKind: seed?.text ? (seed.kind === 'translation' && TAIL ? 'translation-tail' : seed.kind === 'translation' && HYBRID ? 'translation-hybrid' : seed.kind) : null, seedChars: seed?.text ? Math.min(SEED_CHARS, seed.text.length) : 0,
      pages: Object.fromEntries(parsed), pagesParsed: parsed.size, pagesSent: which === 'D' ? pages.length - 1 : pages.length, overlapPages: which === 'D' ? 1 : 0, retried,
      error: res.error || null, finish: res.finish || null, inTok: res.inTok || 0, outTok: res.outTok || 0,
      cost_usd: cost, at: new Date().toISOString(),
    };
    stream.write(JSON.stringify(row) + '\n');
    return row;
  };

  /** Arm E: repair B's seam page against the previous page's translation. One small call. */
  const callRepair = async (r, lastPrev, bRow, which = 'E') => {
    const first = r.next[0];
    const bFirst = bRow?.pages?.[first.page_number];
    if (!bFirst || spent >= approved) return null;
    const prompt = seamRepairPrompt(bookOf(r), lastPrev, first.ocr, bFirst);
    const t0 = Date.now();
    const res = await gemini(prompt, maxOutFor([first]), MODEL);
    const cost = res.error ? 0 : (res.inTok / 1e6) * price.input + (res.outTok / 1e6) * price.output;
    await logUsage({
      type: 'translation', mode: 'realtime', model: MODEL, book_id: r.bookId, page_count: 1,
      input_tokens: res.inTok || 0, output_tokens: res.outTok || 0, cost_usd: cost, status: res.error ? 'error' : 'success',
      error_message: res.error || null, duration_ms: Date.now() - t0, prompt_version: TAIL ? 'seam-repair-e2-tail' : 'seam-repair-e1', endpoint: ENDPOINT, triggered_by: 'manual',
    }, db).catch((e) => console.warn(`usage log failed: ${e.message}`));
    spent += cost;
    const repaired = res.error ? null : sanitizeTranslationTags((res.text || '').replace(/^```[a-z]*\n?|```\s*$/g, '').trim());
    const pages = { ...bRow.pages };
    if (repaired) pages[first.page_number] = repaired; else delete pages[first.page_number];
    const row = {
      bookId: r.bookId, language: r.language, which, seamPage: r.seamPage, model: MODEL, seedKind: TAIL ? 'repair-pass-tail' : 'repair-pass', seedChars: Math.min(SEED_CHARS, lastPrev.length),
      pages, pagesParsed: Object.keys(pages).length, pagesSent: 1, retried: false, error: res.error || null, finish: res.finish || null,
      inTok: res.inTok || 0, outTok: res.outTok || 0, cost_usd: cost, at: new Date().toISOString(),
    };
    stream.write(JSON.stringify(row) + '\n');
    return row;
  };

  const have = new Map(readRows().map((x) => [`${x.bookId}:${x.which}`, x]));
  let n = 0;
  await pool(payload.sample, CONCURRENCY, async (r) => {
    // Block k-1: once, shared by every arm. Seeded from the database when production would be.
    let prev = have.get(`${r.bookId}:prev`);
    if (!prev) prev = await callBlock(r, 'prev', r.prev, r.dbSeed ? { kind: 'translation', text: r.dbSeed } : null);
    const lastPrev = prev?.pages?.[r.prev[BLOCK - 1].page_number];
    if (lastPrev) {
      const seeds = {
        A: { kind: 'translation', text: lastPrev },
        B: null,
        C: { kind: 'source', text: r.prev[BLOCK - 1].ocr },
      };
      for (const arm of TAIL || HYBRID ? [] : ARMS) {
        if (have.has(`${r.bookId}:${arm}`)) continue;
        await callBlock(r, arm, r.next, seeds[arm]);
      }
      if (HYBRID && !have.has(`${r.bookId}:Ah`)) await callBlock(r, 'Ah', r.next, seeds.A);
      if (TAIL) {
        if (!have.has(`${r.bookId}:At`)) await callBlock(r, 'At', r.next, seeds.A);
        if (!have.has(`${r.bookId}:Et`)) await callRepair(r, lastPrev, have.get(`${r.bookId}:B`), 'Et');
      }
      // Arm D (Amendment 1, run only with --with-d once B and C have failed): block k-1's last
      // page rides along as the first page of the prompt, unseeded, and its duplicate is discarded.
      if (has('with-d') && !have.has(`${r.bookId}:D`)) await callBlock(r, 'D', [r.prev[BLOCK - 1], ...r.next], null);
      // A2: arm A run a second time, identically. NOT an arm and NOT in the decision rule — it is the
      // noise floor: how far two runs of the SAME configuration sit apart on H1. Descriptive, added
      // after the arms were scored, and labelled so wherever it is printed.
      if (has('with-a2') && !have.has(`${r.bookId}:A2`)) await callBlock(r, 'A2', r.next, seeds.A);
      // Arm E (Amendment 1, last rung, run only with --with-e once B, C and D have failed): a second
      // pass over B's FIRST page only. It is never shown pages 2-8, so it cannot edit outside the seam.
      if (!TAIL && !HYBRID && has('with-e') && !have.has(`${r.bookId}:E`)) await callRepair(r, lastPrev, have.get(`${r.bookId}:B`));
    } else if (!prev?.skipped) {
      console.log(`  ${r.bookId}: block k-1 did not return its last page — boundary unusable, arms NOT run (recorded, not padded)`);
    }
    if (++n % 10 === 0) console.log(`  ${n}/${payload.sample.length} boundaries  spent $${spent.toFixed(3)}`);
  });
  stream.end();
  console.log(`\ndone. actual spend $${spent.toFixed(3)} (estimate $${est.usd.toFixed(2)}, ceiling $${CEILING_USD})`);
  console.log(`wrote ${OUT_FILE}`);
}

// ── phase: score ────────────────────────────────────────────────────────────
function loadBoundaries() {
  const sample = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8')).sample;
  const rows = readRows();
  const spend = rows.reduce((s, r) => s + (r.cost_usd || 0), 0);
  const by = new Map();
  for (const r of rows) { if (!by.has(r.bookId)) by.set(r.bookId, {}); by.get(r.bookId)[r.which] = r; }
  const usable = [], dropped = [];
  for (const s of sample) {
    const b = by.get(s.bookId) || {};
    const firstNext = s.next[0].page_number;
    const missing = ARMS.filter((a) => !b[a]?.pages?.[firstNext]);
    if (!b.prev?.pages?.[s.prev[BLOCK - 1].page_number]) { dropped.push({ bookId: s.bookId, why: 'block k-1 lost its last page' }); continue; }
    if (missing.length) { dropped.push({ bookId: s.bookId, why: `arm ${missing.join('+')} lost the first page of block k` }); continue; }
    usable.push({ s, rows: b });
  }
  return { usable, dropped, spend, nSample: sample.length };
}

function scoreArm(s, row, terms) {
  const ocr = s.next.map((p) => p.ocr).join('\n');
  const text = s.next.map((p) => row.pages[p.page_number] || '').join('\n');
  const perPage = s.next.map((p) => scoreTranslation(row.pages[p.page_number] || '', p.ocr));
  const sum = (f) => perPage.reduce((n, x) => n + f(x), 0);
  const firstOnly = terminologyConsistency(terms, s.next[0].ocr, row.pages[s.next[0].page_number] || '');
  return {
    h1: terminologyConsistency(terms, ocr, text), h1_first_page: firstOnly,
    body_chars: sum((x) => x.body_chars), invented_tags: sum((x) => x.invented_tags), housekeeping_tags: sum((x) => x.housekeeping_tags),
    pages_parsed: row.pagesParsed,
  };
}

function judgeShare(pair) {
  if (!fs.existsSync(VERDICTS_FILE) || !fs.existsSync(KEY_FILE)) return null;
  const key = new Map(JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')).filter((k) => k.pair === pair).map((k) => [k.id, k]));
  const verdicts = JSON.parse(fs.readFileSync(VERDICTS_FILE, 'utf8')).filter((v) => key.has(v.id));
  if (!verdicts.length) return null;
  let aWins = 0, otherWins = 0, ties = 0;
  for (const v of verdicts) {
    const k = key.get(v.id);
    const side = String(v.verdict).toUpperCase();
    if (side !== 'LEFT' && side !== 'RIGHT') { ties++; continue; }
    const first = k.pair.includes('-') ? k.pair.split('-')[0] : 'A';
    if (k[side.toLowerCase()] === first) aWins++; else otherWins++;
  }
  const n = aWins + otherWins + ties;
  return { n, a_wins: aWins, other_wins: otherWins, ties, a_share: (aWins + 0.5 * ties) / n, sign_p: binomTwoSided(aWins, aWins + otherWins) };
}

function phaseScore() {
  const { usable, dropped, spend, nSample } = loadBoundaries();
  console.log(`boundaries scored: ${usable.length}/${nSample}   dropped: ${dropped.length}   actual spend on disk: $${spend.toFixed(3)}\n`);
  for (const d of dropped) console.log(`  dropped ${d.bookId}: ${d.why}`);
  if (usable.length < 2) { console.log('nothing to score'); return; }

  const scored = usable.map(({ s, rows }) => {
    const terms = committedTerms(s.prev.map((p) => rows.prev.pages[p.page_number] || ''));
    const present = [...ARMS, 'D', 'E', 'A2', 'At', 'Et', 'Ah'].filter((a) => rows[a]?.pages?.[s.next[0].page_number]);
    return { s, rows, terms, arms: Object.fromEntries(present.map((a) => [a, scoreArm(s, rows[a], terms)])) };
  });

  // Shuffled control: the same block k, scored against ANOTHER same-language book's committed terms.
  const shuffled = [];
  for (const b of scored) {
    const peers = scored.filter((o) => o !== b && o.s.language === b.s.language && o.terms.length);
    if (!peers.length) continue;
    const peer = peers[(scored.indexOf(b) + 1) % peers.length];
    const ocr = b.s.next.map((p) => p.ocr).join('\n');
    const text = b.s.next.map((p) => b.rows.A.pages[p.page_number] || '').join('\n');
    // Eligibility is waived here on purpose: another book's source forms rarely recur, and the
    // question for the control is only "how often do these renderings turn up by chance".
    const words = new Set(fold(text).split(' '));
    const hit = peer.terms.filter((t) => t.renderings.some((r) => r.every((w) => words.has(w)))).length;
    shuffled.push({ num: hit, den: peer.terms.length, ocrLen: ocr.length });
  }
  resetSeed();
  const control = bootstrapRatioCI(shuffled.map((x) => x.num), shuffled.map((x) => x.den));

  const withTerms = scored.filter((b) => b.arms.A.h1.eligible > 0);
  const hasD = scored.some((b) => b.arms.D);
  const pooled = (arm, f = (x) => x.h1) => { const w = withTerms.filter((b) => b.arms[arm]); resetSeed(); return bootstrapRatioCI(w.map((b) => f(b.arms[arm]).consistent), w.map((b) => f(b.arms[arm]).eligible)); };
  const compare = (arm) => {
    const w = withTerms.filter((b) => b.arms[arm]);
    const a = w.map((b) => b.arms.A.h1.rate), x = w.map((b) => b.arms[arm].h1.rate);
    resetSeed(); const unpaired = diffCI(a, x);
    resetSeed(); const pairedCI = bootstrapCI(x.map((v, i) => v - a[i]));
    const better = x.filter((v, i) => v > a[i]).length, worse = x.filter((v, i) => v < a[i]).length;
    return { delta: mean(x) - mean(a), paired_ci: pairedCI, diffCI: unpaired, better, worse, same: x.length - better - worse, sign_p: binomTwoSided(better, better + worse) };
  };
  const MARGIN = -0.05;
  const h3 = (arm) => {
    const have = scored.filter((b) => b.arms[arm]);
    const rel = (mean(have.map((b) => b.arms[arm].body_chars)) - mean(have.map((b) => b.arms.A.body_chars))) / mean(have.map((b) => b.arms.A.body_chars));
    const tagGate = (f) => { resetSeed(); const d = diffCI(have.map((b) => f(b.arms.A)), have.map((b) => f(b.arms[arm]))); return { a: mean(have.map((b) => f(b.arms.A))), x: mean(have.map((b) => f(b.arms[arm]))), ci: d?.ci, regressed: !!(d?.decisive && d.delta > 0) }; };
    const invented = tagGate((x) => x.invented_tags), housekeeping = tagGate((x) => x.housekeeping_tags);
    return { body_relative: rel, invented, housekeeping, pages_parsed: mean(have.map((b) => b.arms[arm].pages_parsed)), pass: rel >= -0.10 && !invented.regressed && !housekeeping.regressed };
  };

  const report = {
    at: new Date().toISOString(), model: MODEL, n_sample: nSample, n_scored: scored.length, dropped, spend_usd: spend,
    mid_sentence: scored.filter((b) => b.s.midSentence).length,
    h1: { boundaries_with_eligible_terms: withTerms.length, eligible_terms: withTerms.reduce((n, b) => n + b.arms.A.h1.eligible, 0), margin_pp: 5 },
    control_shuffled: control, arms: {},
  };
  const hasE = scored.some((b) => b.arms.E);
  const SHOWN = [...ARMS, ...(hasD ? ['D'] : []), ...(hasE ? ['E'] : []), ...(scored.some((b) => b.arms.A2) ? ['A2'] : []), ...['At', 'Et', 'Ah'].filter((a) => scored.some((b) => b.arms[a]))];
  for (const arm of SHOWN) report.arms[arm] = { n: scored.filter((b) => b.arms[arm]).length, h1_pooled: pooled(arm), h1_first_page_pooled: pooled(arm, (x) => x.h1_first_page), body_chars: mean(scored.filter((b) => b.arms[arm]).map((b) => b.arms[arm].body_chars)) };
  for (const arm of SHOWN.slice(1)) {
    const c = compare(arm), g = h3(arm), j = judgeShare(`A${arm}`);
    report.arms[arm].vs_A = {
      h1: { ...c, pass: !!(c.paired_ci && c.paired_ci[0] > MARGIN) },
      h3: g,
      h2: j ? { ...j, pass: j.a_share <= 0.60 } : null,
    };
  }
  // Mid-sentence seams are where a seed should matter most; descriptive, not part of the rule.
  const ms = withTerms.filter((b) => b.s.midSentence);
  if (ms.length >= 2) report.mid_sentence_subgroup = { n: ms.length, A: mean(ms.map((b) => b.arms.A.h1.rate)), B: mean(ms.map((b) => b.arms.B.h1.rate)), C: mean(ms.map((b) => b.arms.C.h1.rate)), ...(hasD ? { D: mean(ms.filter((b) => b.arms.D).map((b) => b.arms.D.h1.rate)) } : {}) };

  const verdict = (arm) => { const v = report.arms[arm].vs_A; return v.h2 == null ? null : v.h1.pass && v.h2.pass && v.h3.pass; };
  const bPass = verdict('B'), cPass = verdict('C'), dPass = hasD ? verdict('D') : undefined;
  report.decision = bPass === null ? 'PENDING — H2 judge verdicts for A/B not in yet'
    : bPass ? 'RUNG 1 — B passes H1, H2 and H3: migrate to the Batch API with no continuity seed'
    : cPass === null ? 'PENDING — B failed; H2 judge verdicts for A/C not in yet'
    : cPass ? 'RUNG 2 — B fails, C passes: migrate to batch with the source-text seed'
    : dPass === undefined ? 'B and C fail — Amendment 1 sends this to arm D (overlap), not yet run'
    : dPass === null ? 'PENDING — B and C failed; H2 judge verdicts for A/D not in yet'
    : dPass ? 'RUNG 3 — B and C fail, D passes: migrate to batch with a one-page overlap'
    : !hasE ? 'B, C and D all fail — Amendment 1 sends this to arm E (seam-repair pass), not yet run'
    : verdict('E') === null ? 'PENDING — B, C and D failed; H2 judge verdicts for A/E not in yet'
    : verdict('E') ? 'RUNG 4 — B, C and D fail, E passes: migrate to batch with a seam-repair second pass'
    : 'RUNG 5 — nothing passes: do not migrate; report the cost of the quality';

  const pct = (x) => (x == null ? '  —  ' : (x * 100).toFixed(1) + '%');
  console.log('═══ H1: cross-boundary terminology consistency (pooled, bootstrap clustered on boundary) ═══');
  console.log(`  ${withTerms.length} of ${scored.length} boundaries carry at least one eligible term; ${report.h1.eligible_terms} eligible terms in all`);
  for (const arm of SHOWN) { const p = report.arms[arm].h1_pooled, f = report.arms[arm].h1_first_page_pooled; console.log(`  ${arm}: ${pct(p.rate)}  [${pct(p.ci?.[0])}, ${pct(p.ci?.[1])}]    first page of block k only: ${pct(f.rate)} over ${f.denom}`); }
  console.log(`  SHUFFLED CONTROL (another book's terms, same language): ${pct(control.rate)}  [${pct(control.ci?.[0])}, ${pct(control.ci?.[1])}] over ${control.denom} terms`);
  console.log(`  ${control.rate != null && report.arms.A.h1_pooled.rate > (control.ci?.[1] ?? 1) ? 'the probe fires: real consistency sits above the chance band' : 'WARNING: real consistency is NOT above the chance band — the probe may be inert'}`);
  for (const arm of SHOWN.slice(1)) {
    const v = report.arms[arm].vs_A;
    console.log(`\n═══ ${arm} vs A ═══${arm === 'A2' ? '   (NOISE FLOOR: arm A run twice. Descriptive, post hoc, not in the decision rule)' : ''}`);
    console.log(`  H1  Δ=${pct(v.h1.delta)}  paired 95% CI [${pct(v.h1.paired_ci?.[0])}, ${pct(v.h1.paired_ci?.[1])}]  (unpaired diffCI [${pct(v.h1.diffCI?.ci?.[0])}, ${pct(v.h1.diffCI?.ci?.[1])}])  better ${v.h1.better} / worse ${v.h1.worse} / same ${v.h1.same}  → ${v.h1.pass ? 'PASS' : 'FAIL'} (lower bound must exceed −5pp)`);
    console.log(`  H3  body ${pct(v.h3.body_relative)} vs A; invented tags ${v.h3.invented.a.toFixed(2)}→${v.h3.invented.x.toFixed(2)}; housekeeping ${v.h3.housekeeping.a.toFixed(2)}→${v.h3.housekeeping.x.toFixed(2)}; pages parsed ${v.h3.pages_parsed.toFixed(2)}/8  → ${v.h3.pass ? 'PASS' : 'FAIL'}`);
    console.log(v.h2 ? `  H2  judge: A preferred ${v.h2.a_wins}, ${arm} preferred ${v.h2.other_wins}, no preference ${v.h2.ties}; A share ${pct(v.h2.a_share)} (limit 60%)  → ${v.h2.pass ? 'PASS' : 'FAIL'}` : '  H2  judge verdicts not in yet');
  }
  if (report.mid_sentence_subgroup) console.log(`\n  (descriptive) seams that end mid-sentence, n=${report.mid_sentence_subgroup.n}: A ${pct(report.mid_sentence_subgroup.A)}  B ${pct(report.mid_sentence_subgroup.B)}  C ${pct(report.mid_sentence_subgroup.C)}${hasD ? `  D ${pct(report.mid_sentence_subgroup.D)}` : ''}`);
  console.log(`\n═══ DECISION RULE (pre-registered) ═══\n  ⇒ ${report.decision}`);
  const out = path.join(RESULTS, `translation-batch-continuity-report-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`\nwrote ${out}`);
}

// ── phase: judge packet ─────────────────────────────────────────────────────
/** The junction as a reader meets it: page-level wrappers off, inline markup off, prose kept. */
export function readerText(t) {
  // Wrapper set mirrors scripts/lib/strip-editorial-wrappers.mjs (what the site quotes). Until
  // 2026-09-25 this dropped only meta/summary/keywords/warning, so a seam REPAIR — which mirrors the
  // OCR's front matter — showed the judge "good German printed text 65" where production showed
  // nothing: an arm-identifying artifact that also breaks blinding. Strip the same set on every arm.
  return (t || '')
    .replace(/<(meta|summary|keywords|vocab|language|lang|scan-quality|script|page-type|page-num|columns|warning|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<note\b[^>]*>[\s\S]*?<\/note>/gi, ' ')
    .replace(/<gloss\b[^>]*>[\s\S]*?<\/gloss>/gi, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ').replace(/->|<-/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

function phaseJudgePacket() {
  // The left/right flips come from ONE seeded stream walked book by book, so WHICH PAIRS DRAW
  // TOGETHER decides every flip. Re-emitting AB and AC alongside a new pair silently moves their
  // flips, and the key stops matching what the judge read (caught here on 2026-09-17, before any
  // verdict was scored). So: `--pairs` says which pairs draw, `--only` which of them are written,
  // and key entries for pairs not written are kept. As judged: AB and AC came from
  // `--pairs AB,AC`; AD from `--pairs AB,AC,AD --only AD`; AE from `--pairs AE`.
  // A pair is 'A<other>' (legacy: A against one arm) or 'X/Y' (any two arms, e.g. At/Et, A/At).
  // The packet id and file use the pair with '/' replaced by '-'.
  const PAIRS = String(arg('pairs', 'AB,AC')).split(',');
  const ONLY = String(arg('only', PAIRS.join(','))).split(',');
  const sides = (pair) => (pair.includes('/') ? pair.split('/') : ['A', pair.slice(1)]);
  const fileTag = (pair) => pair.replace('/', '-');
  const { usable } = loadBoundaries();
  resetSeed();
  const packet = Object.fromEntries(PAIRS.map((p) => [p, []])), key = [];
  for (const { s, rows } of usable) {
    const preceding = readerText(rows.prev.pages[s.prev[BLOCK - 1].page_number]);
    for (const pair of PAIRS) {
      const [first, second] = sides(pair);
      if (!rows[first]?.pages?.[s.next[0].page_number] || !rows[second]?.pages?.[s.next[0].page_number]) continue;
      const id = `${fileTag(pair)}:${s.bookId}`;
      const flip = seededRand() < 0.5;
      const a = readerText(rows[first].pages[s.next[0].page_number]), x = readerText(rows[second].pages[s.next[0].page_number]);
      packet[pair].push({ id, language: s.language, preceding_page: preceding, left: flip ? x : a, right: flip ? a : x });
      key.push({ id, pair: fileTag(pair), left: flip ? second : first, right: flip ? first : second });
    }
  }
  for (const pair of ONLY) {
    if (!packet[pair]?.length) continue;
    const f = path.join(RESULTS, `translation-batch-continuity-judge-packet-${fileTag(pair)}.jsonl`);
    fs.writeFileSync(f, packet[pair].map((p) => JSON.stringify(p)).join('\n') + '\n');
    console.log(`wrote ${packet[pair].length} blinded junctions to ${f}`);
  }
  const onlyTags = ONLY.map(fileTag);
  const kept = fs.existsSync(KEY_FILE) ? JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')).filter((k) => !onlyTags.includes(k.pair)) : [];
  fs.writeFileSync(KEY_FILE, JSON.stringify([...kept, ...key.filter((k) => onlyTags.includes(k.pair))], null, 1));
  console.log(`key (do NOT give this to the judge): ${KEY_FILE}`);
  console.log('\nJudge question, per junction:');
  console.log('  "PRECEDING_PAGE is the end of a translated passage. LEFT and RIGHT are two translations of');
  console.log('   the page that follows it. Which one reads as the SAME translator continuing — same names,');
  console.log('   same terms, same register, a sentence carried across the page break picked up correctly?');
  console.log('   Answer LEFT, RIGHT or TIE, then one sentence of why."');
  console.log(`Verdicts go to ${VERDICTS_FILE} as [{ id, verdict, why }].`);
}

// ── phase: harness control (FREE, read-only) ────────────────────────────────
/** Word-bigram Dice similarity over reader text: 1 = same wording, ~0 = unrelated. */
export function similarity(x, y) {
  const grams = (t) => { const w = fold(readerText(t)).split(' ').filter(Boolean); const g = new Map(); for (let i = 0; i + 1 < w.length; i++) { const k = `${w[i]} ${w[i + 1]}`; g.set(k, (g.get(k) || 0) + 1); } return g; };
  const a = grams(x), b = grams(y);
  let inter = 0, na = 0, nb = 0;
  for (const [k, n] of a) { na += n; inter += Math.min(n, b.get(k) || 0); }
  for (const n of b.values()) nb += n;
  return na + nb ? (2 * inter) / (na + nb) : null;
}

/**
 * A HARNESS CONTROL, not an outcome. Where a block-k page already carries a stored
 * translation written by the CURRENT production prompt (matched on prompt hash) and
 * model, arm A should reproduce it about as closely as two runs of this harness
 * reproduce each other. Stored translations from older prompts are ignored: eight
 * prompt generations sit in these pages and that confound dwarfs a seam effect.
 *
 * Scale, fixed before looking: sim(A, stored) is compared with sim(A, B) on the SAME
 * pages (two samples of the same configuration, differing only in the seed) and with
 * sim(A, stored-of-another-page) as the floor. PASS when the median sim(A, stored) is
 * at least 0.75 of the median sim(A, B) AND above the 95th percentile of the floor.
 */
async function phaseHarnessControl() {
  const { usable } = loadBoundaries();
  const { db } = await connect();
  const prompts = await loadTranslationPrompts(db);
  const rows = [];
  for (const { s, rows: r } of usable) {
    const ref = (isEnglishBook(bookOf(s)) ? prompts.english : prompts.translation).ref;
    const stored = await db.collection('pages').find(
      // --loose (descriptive only): match on the prompt VERSION label instead of hash+model.
      has('loose')
        ? { id: { $in: s.next.map((p) => p.id) }, 'translation.prompt_version': { $in: [ref.version, String(ref.version), `v${ref.version}`] }, 'translation.source': 'ai', 'translation.updated_at': { $gte: new Date('2026-08-01') } }
        : { id: { $in: s.next.map((p) => p.id) }, 'translation.prompt_hash': ref.content_hash, 'translation.model': MODEL, 'translation.source': 'ai' },
      { projection: { id: 1, page_number: 1, 'translation.data': 1 } }).toArray();
    for (const d of stored) {
      const a = r.A.pages[d.page_number], b = r.B.pages[d.page_number];
      if (!a || !b || typeof d.translation?.data !== 'string') continue;
      rows.push({ bookId: s.bookId, page: d.page_number, language: s.language, stored: d.translation.data, a, b });
    }
  }
  if (rows.length < 5) { console.log(`HARNESS CONTROL: UNMEASURABLE — only ${rows.length} block-k pages carry a stored translation from the current prompt+model. Not a pass.`); return; }
  const med = (xs) => { const v = xs.filter((x) => x != null).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const q = (xs, f) => { const v = xs.filter((x) => x != null).sort((p, q2) => p - q2); return v[Math.min(v.length - 1, Math.floor(v.length * f))]; };
  const aStored = rows.map((x) => similarity(x.a, x.stored));
  const aB = rows.map((x) => similarity(x.a, x.b));
  const floor = rows.map((x, i) => similarity(x.a, rows[(i + Math.ceil(rows.length / 2)) % rows.length].stored));
  const pass = med(aStored) >= 0.75 * med(aB) && med(aStored) > q(floor, 0.95);
  const out = {
    at: new Date().toISOString(), label: 'HARNESS CONTROL — not an outcome', n_pages: rows.length, n_books: new Set(rows.map((x) => x.bookId)).size,
    sim_A_vs_stored: { median: med(aStored), p10: q(aStored, 0.10), p90: q(aStored, 0.90) },
    sim_A_vs_B_same_pages: { median: med(aB), p10: q(aB, 0.10), p90: q(aB, 0.90) },
    floor_A_vs_other_pages_stored: { median: med(floor), p95: q(floor, 0.95) },
    by_language: Object.fromEntries([...new Set(rows.map((x) => x.language))].map((l) => [l, { pages: rows.filter((x) => x.language === l).length, median_A_vs_stored: med(rows.filter((x) => x.language === l).map((x) => similarity(x.a, x.stored))), median_A_vs_B: med(rows.filter((x) => x.language === l).map((x) => similarity(x.a, x.b))) }])),
    criterion: 'median sim(A,stored) >= 0.75 x median sim(A,B) AND > p95 of the floor', pass,
  };
  console.log(JSON.stringify(out, null, 1));
  console.log(`\nHARNESS CONTROL: ${pass ? 'PASS — arm A reproduces what production wrote' : 'FAIL — arm A does NOT reproduce production; the run is not measuring production-vs-batch'}`);
  fs.writeFileSync(path.join(RESULTS, `translation-batch-continuity-harness-control${has('loose') ? '-loose' : ''}.json`), JSON.stringify(out, null, 1));
}

// ── main ────────────────────────────────────────────────────────────────────
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedDirectly) {
  try {
    if (has('draw')) await phaseDraw();
    else if (has('run')) await phaseRun();
    else if (has('score')) phaseScore();
    else if (has('judge-packet')) phaseJudgePacket();
    else if (has('harness-control')) await phaseHarnessControl();
    else console.log('one of --draw | --run | --score | --judge-packet | --harness-control (see the header)');
  } finally {
    await disconnect().catch(() => {});
  }
}
