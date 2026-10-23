// PRIOR ART: scripts/lib/paddle-zh-lane.mjs (#5600 — the Paddle engine block, the four conversions, MIN_HAN,
// the single-character run guard; imported, not copied) and scripts/eval/paddle-split-6101.mjs (#7184 — the NDL
// ruler/label-strip crop and the gutter split this lane runs in production; `rulerTop` is ported here unchanged
// because the eval file runs its CLI on import). Neither is a lane for PRINT: #5600 reads SKQS manuscript volumes
// whole (and drops kana, which Japanese print carries), and #7184 wrote nothing.
//
// The Paddle split-leaf PRINT lane (#6101): PaddleOCR-VL 1.6 on split leaves for Chinese and Japanese print
// (woodblock and movable type), outside the Siku Quanshu manuscript cohort, the NDL cursive lane and Meiji typeset.
//
// WHY THIS LANE EXISTS
// On 198 CBETA-referenced woodblock pages (PR #7184) Paddle on split leaves with the NDL label strip cropped has a
// median CER of 0.061 vs flash-lite 0.067 (Δ −0.014 [−0.020, −0.003]) and as few catastrophic pages (3/198 each),
// at $0 on the GEX45. It is NOT better than Gemini 3 Flash (0.052), so it never replaces a Flash read (or a human,
// typed-edition or other specialist read): it reads pages with no text, and replaces flash-lite and whole-spread
// Paddle reads only.
//
// THE LEAF GUARDS (#7184: all three of P1's catastrophic pages had a blank leaf)
//   1. Blank leaf, by the IMAGE: ink in the inner 80 % of the leaf (pixels ≥ 60 grey levels below the page ground)
//      below INK_BLANK. Measured 2026-10-23 on the 3,880 #7184 leaves: every blank-leaf loop ≤ 0.011, the lowest
//      leaf with real text 0.046. A blank leaf is not sent to the GPU; it contributes no text.
//   2. Loop, by the TEXT, per leaf: ocr-loop-guard's loopVerdict, the single-character run (#5660), a short unit
//      repeated ≥ 8 times in a row (the #5100 note: loopVerdict misses `地震`×30), a deflate ratio below
//      MAX_DEFLATE on ≥ 200 characters (the #7184 blank-leaf loops recite 卷一 … 卷四十, which is not periodic:
//      ratio 0.018–0.055 against ≥ 0.31 for every real leaf), and more Han than a leaf can hold. A looping leaf
//      rejects the whole PAGE (its other leaf alone is half a page); the stored text stays.
//   Not caught: a blank leaf with show-through Paddle reads as text (1de682-p45 R: ink 0.047, 95 invented
//   characters, 1 of 3,880 leaves). Residual, stated in the PR.
//
// NOTHING IS PAID, NOTHING IS TRANSLATED here. Every book is HELD (paddle-print-6101) before its first page write.

import zlib from 'node:zlib';
import { loopVerdict } from './ocr-loop-guard.mjs';
import { contentHash } from './write-provenance.mjs';
import { writePageText } from './page-text-writer.mjs';
import { PADDLE, MIN_HAN, MAX_CHAR_RUN, convertPaddle, bodyHanCount, longestCharRun, isHumanEdited } from './paddle-zh-lane.mjs';

export { isHumanEdited, markTranslationsStale, STALE_OCR_FIELDS } from './paddle-zh-lane.mjs';
export { PADDLE, MIN_HAN };

/** `ocr.pipeline`, `sweep_log.sweep`, `translation_stale.lane` and the run-id prefix. */
export const LANE = 'paddle-print-2026-10';
export const LANE_ISSUE = 6101;
export const HOLD_REASON = 'paddle-print-6101';
export const HOLD_RELEASE = 'the Paddle split-leaf read of this print book is written (#6101, OCR only); translation is its own decision (job qwen-translate-eval-6101 decides the engine); release with --to ocr_complete';
export const REVISION_REASON = 'reocr_paddle_print_6101';
export const BOOK_EVENT = 'paddle_print_ocr';

/** Inner-leaf ink below this = a blank leaf (calibrated above). */
export const INK_BLANK = 0.02;
/** deflate(bytes)/bytes below this on a long leaf = a recited, non-periodic loop. */
export const MAX_DEFLATE = 0.15;
/** A woodblock half-folio holds ~200–360 Han (#7184 p50–p99); 1,500 is beyond any leaf. */
export const MAX_LEAF_HAN = 1500;
/** Width / height at or above which an image is a two-leaf spread. NDL spreads ≈ 1.3–1.5, single leaves ≈ 0.6–0.8. */
export const SPREAD_ASPECT = 1.0;
/** The split overlap split-book.mjs uses (#1491 lesson 6: 1 % clipped tight gutters). */
export const OVERLAP = 0.03;
/** NDL's label strip as Paddle reads it (cbeta-ref-6101.mjs `nolabel`, unchanged). */
export const LABEL_LINE = /国立国会図書館|國立國會圖書館|請求記号|ガラス使用/;

const KANA_G = /[぀-ヿㇰ-ㇿｦ-ﾟ]/gu;

/** Han + kana outside the margin marks: the reading a page carries (a kana-majiri page is text with few Han). */
export function bodyCharCount(body) {
  const b = String(body || '').replace(/<(header|page-num)>[\s\S]*?<\/\1>/g, '');
  return bodyHanCount(b) + (b.match(KANA_G) || []).length;
}

/** Envelope language for a book's `language` field ('Classical Chinese' → Chinese). */
export function laneLanguage(bookLanguage) {
  return /^Japanese|Japanese$/.test(String(bookLanguage || '')) && !/^Chinese/.test(String(bookLanguage)) ? 'Japanese' : 'Chinese';
}

/**
 * What the stored reading of a page is, as far as this lane is concerned: `{ action: 'read'|'keep', why }`.
 * READ only: no text, flash-lite, or a Paddle read of a whole spread. KEEP everything else — a human edit, any
 * Flash / Pro / Claude read (Flash is the better reader, #7184), a typed edition (CBETA), the Archive's text,
 * another specialist engine, a Paddle read of a single leaf (the same engine on the same leaf), and a page this
 * lane already wrote.
 */
export function storedPolicy(ocr, { spread }) {
  if (isHumanEdited(ocr)) return { action: 'keep', why: 'human_edited' };
  const text = typeof ocr?.data === 'string' ? ocr.data.trim() : '';
  if (!text || text === '[RECITATION_BLOCKED]') return { action: 'read', why: 'no_text' };
  if (ocr.pipeline === LANE) return { action: 'keep', why: 'this_lane' };
  const model = String(ocr.model || '');
  if (/flash-lite/i.test(model)) return { action: 'read', why: 'flash_lite' };
  if (ocr.source === 'paddle') return spread ? { action: 'read', why: 'paddle_whole_spread' } : { action: 'keep', why: 'paddle_single_leaf' };
  if (/gemini/i.test(model) && /flash/i.test(model)) return { action: 'keep', why: 'gemini_flash' };
  if (/gemini/i.test(model) && /pro/i.test(model)) return { action: 'keep', why: 'gemini_pro' };
  if (/claude|opus|sonnet/i.test(model) || ocr.engine?.vendor === 'anthropic') return { action: 'keep', why: 'claude' };
  if (/cbeta/i.test(String(ocr.source || ''))) return { action: 'keep', why: 'typed_edition' };
  return { action: 'keep', why: `other:${ocr.source || 'unknown'}${model ? `/${model}` : ''}` };
}

export function isSpread(w, h) {
  return !!(w && h) && w / h >= SPREAD_ASPECT;
}

/** Inner-80 % ink of a greyscale raw leaf: share of pixels ≥ 60 levels below the 95th-percentile ground. */
export function innerInk(data, width, height) {
  const x0 = Math.round(width * 0.1), x1 = Math.round(width * 0.9), y0 = Math.round(height * 0.1), y1 = Math.round(height * 0.9);
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { hist[data[y * width + x]]++; n++; }
  if (!n) return null;
  let seen = 0, ground = 255;
  for (let v = 255; v >= 0; v--) { seen += hist[v]; if (seen >= n * 0.05) { ground = v; break; } }
  let dark = 0;
  for (let v = 0; v <= Math.max(0, ground - 60); v++) dark += hist[v];
  return dark / n;
}

/** The longest run of one short unit (2–8 characters) repeated back to back, as repetitions. */
export function shortUnitRepeats(text) {
  const s = String(text || '').replace(/\s+/g, '');
  let best = 0;
  for (const m of s.matchAll(/(.{2,8}?)\1{7,}/gu)) best = Math.max(best, Math.floor(m[0].length / m[1].length));
  return best;
}

export function deflateRatio(text) {
  const b = Buffer.from(String(text || '').replace(/\s+/g, ''), 'utf8');
  return b.length ? zlib.deflateSync(b).length / b.length : 1;
}

/**
 * Conversions on one leaf's raw Paddle output: HTML flattened, the NDL label strip dropped, the 版心 margin marked
 * (convertPaddle, keepKana — Japanese print and kunten carry kana). Returns `{ body, stats }`.
 */
export function convertLeaf(raw, { workTitle = null } = {}) {
  let label = 0;
  const kept = String(raw || '').split(/\r?\n/).filter((l) => { if (LABEL_LINE.test(l)) { label++; return false; } return true; }).join('\n');
  const { body, stats } = convertPaddle(kept, { workTitle, keepKana: true });
  return { body, stats: { ...stats, label_lines_dropped: label } };
}

/** Is this leaf's text a loop? `{ loop: bool, reason, ... }` — the five checks in the header, cheapest first. */
export function leafLoop(body) {
  const han = bodyHanCount(body);
  if (han > MAX_LEAF_HAN) return { loop: true, reason: 'over_capacity', han };
  const run = longestCharRun(body);
  if (run > MAX_CHAR_RUN) return { loop: true, reason: 'char_run', run };
  const reps = shortUnitRepeats(body);
  if (reps >= 8) return { loop: true, reason: 'short_unit', reps };
  const chars = String(body || '').replace(/\s+/g, '').length;
  if (chars >= 200) { const z = deflateRatio(body); if (z < MAX_DEFLATE) return { loop: true, reason: 'deflate', z: +z.toFixed(3), chars }; }
  const v = loopVerdict(body);
  if (v.refuse) return { loop: true, reason: 'loop_guard', share: v.share, period: v.period };
  return { loop: false };
}

/**
 * One page from its leaves. `leaves`: `[{ side: 'R'|'L'|'S', blank: bool, raw: string|null, err: string|null }]` in
 * reading order (right leaf, then left; or the single leaf). Returns
 *   { verdict: 'write', body, stats, han }   — the page text (leaves joined, one line break between them: on a
 *                                               thread-bound spread the text runs on across the fold)
 *   { verdict: 'textless', han }              — the leaves carry fewer than MIN_HAN Han + kana outside the margin marks
 *   { verdict: 'reject', reason, side, ... }  — a leaf failed on the box, or looped
 */
export function assemblePage(leaves, { workTitle = null } = {}) {
  const bodies = [];
  const stats = { leaves: leaves.length, blank_leaves: 0, label_lines_dropped: 0, header_lines: 0, page_num_lines: 0, img_dropped: 0, tables_flattened: 0, non_han_lines_dropped: 0 };
  for (const lf of leaves) {
    if (lf.blank) { stats.blank_leaves++; continue; }
    if (lf.err || lf.raw == null) return { verdict: 'reject', reason: 'leaf_error', side: lf.side, err: String(lf.err || 'missing').slice(0, 80) };
    const { body, stats: s } = convertLeaf(lf.raw, { workTitle });
    const l = leafLoop(body);
    if (l.loop) return { ...l, verdict: 'reject', reason: `leaf_loop:${l.reason}`, side: lf.side };
    for (const k of ['label_lines_dropped', 'header_lines', 'page_num_lines', 'img_dropped', 'tables_flattened', 'non_han_lines_dropped']) stats[k] += s[k] || 0;
    if (body.trim()) bodies.push(body.trim());
  }
  const body = bodies.join('\n');
  const han = bodyCharCount(body);
  if (han < MIN_HAN) return { verdict: 'textless', han };
  return { verdict: 'write', body, stats, han };
}

export function envelope(body, language) {
  return `<language>${language}</language>\n<script>printed</script>\n\n${String(body || '').trim()}`;
}

/**
 * The whole `ocr` field this lane writes (writePageText replaces the field; the prior one is kept in full in the
 * revision row). `box` = the GPU run's run.json (versions, host, GPU, weights hash, serving); `leaves` = the crop
 * boxes and ink per leaf, so a reader of the text can find the pixels each part came from.
 */
export function ocrField(text, { language, run, now = new Date(), imageUrl = null, box = {}, stats = null, leaves = [], spread = false, why = null } = {}) {
  return {
    data: text,
    content_hash: contentHash(text),
    language,
    model: PADDLE.model,
    source: 'paddle',
    pipeline: LANE,
    updated_at: now,
    engine: {
      name: PADDLE.name, model: PADDLE.model, version: PADDLE.version, model_label: PADDLE.label,
      repo: PADDLE.repo, model_url: PADDLE.model_url, licence: PADDLE.licence,
      stack: {
        paddleocr: box.paddleocr_version || PADDLE.stack.paddleocr, paddlex: box.paddlex_version || PADDLE.stack.paddlex,
        'paddlepaddle-gpu': box.paddle_version || PADDLE.stack['paddlepaddle-gpu'], source: box.paddleocr_version ? 'logged' : 'pinned (box did not report)',
      },
      ...(box.weights_sha256
        ? { revision: `sha256:${box.weights_sha256}`, revision_source: 'logged: sha256 of the weights file the box loaded' }
        : { revision_source: 'not_recorded: the box run did not hash the weights' }),
      conventions: 'split leaves (spread cut at the gutter with 3 % overlap, NDL ruler + label strip cropped), layout detection off, read right leaf then left, joined with one line break; blank leaves (inner ink < 0.02) not read; NDL label lines dropped; the 版心 margin marked <header>/<page-num>; kana kept; <img> dropped; tables flattened (#6101, PR #7184)',
      measured: 'PR #7184: 198 CBETA-referenced woodblock pages, median CER 0.061 vs flash-lite 0.067 (Δ −0.014 [−0.020, −0.003]), catastrophic 3/198 each; Flash 0.052 stays the better reader',
      postprocess: stats, run, issue: LANE_ISSUE, host: box.host || null, gpu: box.gpu || null,
      serving: box.backend ? { backend: box.backend, runners: box.workers ?? null, vllm: box.vllm_version || null, layout: 0 } : null,
      input: imageUrl ? { image_url: imageUrl, spread, leaves } : { status: 'not_recorded', reason: 'caller passed no image url' },
      replaced: why,
    },
  };
}

/** Write one page through the one writer (#7058): revision with the whole prior field, CAS on the prior text. */
export async function writeLanePage(db, pageId, field, { run }) {
  return writePageText(db, pageId, 'ocr', field, { by: `${LANE} (scripts/workers/paddle-print-lane.mjs)`, reason: REVISION_REASON, run_id: run });
}
