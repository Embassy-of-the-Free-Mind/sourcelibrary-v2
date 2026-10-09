// PRIOR ART: scripts/lib/ndl-koten-lane.mjs (#4925) — the same lane shape (hold before the first
// write, revisions first, human-edit guard, loop guard, provenance on the page, staleness stamp)
// for a different engine; its script-agnostic helpers come from scripts/lib/syriac-kraken-lane.mjs
// and are imported, not copied. What differs is the ENGINE (PaddleOCR-VL on a leased L4), the
// COHORT (a fixed id list, deduplicated by Kanripo juan key, not a router) and the CONVERSIONS
// Paddle's raw output needs before it is a page reading (#5568 test 3, below).
//
// The Paddle Chinese lane (#5600; evidence #5547, #5568): read the 7,894 Wenyuange Siku Quanshu
// manuscript volumes held out of #4719 with PaddleOCR-VL-1.6.
//
// WHY THIS LANE EXISTS
// On 433 referenced SKQS manuscript pages flash-lite was catastrophic (CER > 0.5) on 10.6 %
// [8.1, 13.9] and PaddleOCR-VL on 0.9 % [0.4, 2.4] (#5547); the English made from Paddle's text is
// preferred 20–4 in both judge orders (#5568 T2a). Readers of these books otherwise get one page in
// ten unreadable.
//
// THE FOUR CONVERSIONS (#5568 test 3, measured on 2,713 pilot pages)
//   1. Envelope: `<language>Chinese</language><script>handwritten</script>` as the Kraken and NDL
//      lanes write it; no `<page-type>` — Paddle does not classify pages, so none is claimed.
//   2. The 版心 margin: Paddle reads the fold strip into the body. `四庫全書` lines, the bare juan
//      line (`卷四之二`) and the leaf number beside them become `<header>` / `<page-num>` (real page
//      marks, quotable — quote-and-snippet-integrity.md); lines carrying kana are dropped (SKQS has
//      no kana: 35 % of pilot pages carried strings like `金ちゃんさん` read off the margin), and so are
//      lines with no Han character at all (`1`, `||`, `F`, `——` — rulings and margin noise; an SKQS
//      page carries no Latin letters or Arabic digits).
//   3. HTML: `<img src="imgs/…">` points at a file that never existed and is dropped (a plate gets no
//      `<image-desc>` from Paddle); `<table>` is flattened to one line per row.
//   4. Provenance: `ocr.source: 'paddle'` is in the specialist set of write-provenance.mjs and its TS
//      twin, so the checker requires engine.name/model/run; the block below records the model, the
//      paddleocr / paddlex / paddlepaddle-gpu stack, the run, host, GPU, image URL, and what the
//      conversions removed (`engine.postprocess`) — so a reader of the stored text can tell what the
//      engine read from what this file dropped.
//
// NOTHING IS PAID, NOTHING IS TRANSLATED. No Gemini call is made anywhere in this lane. Every book is
// HELD (scripts/lib/pipeline-hold.mjs, reason paddle-zh-5600-ocr-only) before its first page is
// written, because an OCR write onto a `complete` book otherwise queues paid gap-fill translation
// (pipeline-status-truth.md, #4523). Translation is its own decision.

import { contentHash } from './write-provenance.mjs';

export { isHumanEdited, hasRealTranslation, STALE_OCR_FIELDS, markTranslationsStale } from './syriac-kraken-lane.mjs';

/** `ocr.pipeline` value, `sweep_log.sweep` name and `translation_stale.lane` — one id for the lane. */
export const LANE = 'paddle-zh-2026-10';
// A later run of the SAME lane (same engine, writer and guards) names its own issue, hold and revision reason
// through PADDLE_ZH_ISSUE / PADDLE_ZH_HOLD / PADDLE_ZH_HOLD_RELEASE (#5660 job gpu-backlog-5660: the ≈ 5K SKQS
// volumes outside the #4719 cohort). Unset, every value is the #5600 run's.
export const LANE_ISSUE = Number(process.env.PADDLE_ZH_ISSUE || 5600);
/** `page_revisions.reason` for the reading this lane supersedes. */
export const REVISION_REASON = `reocr_paddle_zh_${LANE_ISSUE}`;
/** `book_events.type` — one row per book, advanced in place. */
export const BOOK_EVENT = 'paddle_zh_reocr';
/** `pipeline_auto.hold.reason` for every book the lane touches. */
export const HOLD_REASON = process.env.PADDLE_ZH_HOLD || 'paddle-zh-5600-ocr-only';
export const HOLD_RELEASE = process.env.PADDLE_ZH_HOLD_RELEASE || 'translation of the Paddle-read Siku Quanshu cohort is approved as its own priced decision (#5600 is OCR only); release with --to ocr_complete';
/** Below this many Han characters a Paddle read is textless: it replaces a loop, never a reading. */
export const MIN_HAN = 8;

/** The engine, in ONE place. The box run fills what it measured (versions, host, GPU, weights hash). */
export const PADDLE = {
  name: 'PaddleOCR-VL',
  model: 'PaddleOCR-VL-1.6-0.9B',
  version: '1.6',
  label: 'PaddleOCR-VL 1.6 (Baidu PaddlePaddle), PaddleOCRVL() default pipeline',
  repo: 'https://github.com/PaddlePaddle/PaddleOCR',
  model_url: 'https://huggingface.co/PaddlePaddle/PaddleOCR-VL',
  licence: 'Apache-2.0',
  stack: { paddleocr: '3.7.0', paddlex: '3.7.2', 'paddlepaddle-gpu': '3.2.1' },
  conventions: 'the pipeline\'s parsing blocks in its reading order, one block per line; the 版心 margin marked <header>/<page-num>; kana and non-Han lines dropped; <img> dropped; tables flattened (#5568 test 3)',
  measured: '#5547: catastrophic (CER > 0.5) on 4/433 SKQS manuscript pages = 0.9 % vs flash-lite 10.6 %; #5568: Paddle-based English preferred 20–4',
};

const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/u;
const HAN = /\p{Script=Han}/u;
const NUM = '[〇零一二兩三四五六七八九十百千]';
/** The SKQS margin title; Paddle misreads 欽 as 金 or drops it. */
const SKQS_LINE = /^[欽钦金]?定?四庫全書$/u;
/** A bare juan line as the fold strip carries it: 卷四 / 卷四之二 / 卷十上. A body heading carries the work title before 卷. */
const JUAN_LINE = new RegExp(`^[卷巻]${NUM}+(?:之${NUM}+|[上中下])?$`, 'u');
const LEAF_LINE = new RegExp(`^${NUM}{1,4}$`, 'u');

/** Han characters in a text (tags and their names do not count: they are ASCII). */
export function hanCount(text) {
  let n = 0;
  for (const ch of String(text || '')) if (HAN.test(ch)) n++;
  return n;
}

/**
 * Han characters OUTSIDE the margin marks (<header>, <page-num>) — the reading a page actually carries. A read whose
 * only text is margin furniture is textless. #5660 stress canary: on a blank SKQS leaf Paddle wrote 欽定四庫全書
 * followed by a recited 卷一 … 卷十 (26 Han, every line a bare juan line, so all of it became <header>); counted
 * with hanCount it passed MIN_HAN and would have been written as the page's text.
 */
/** Longest run of one repeated non-space character. */
export function longestCharRun(text) {
  let best = 0, run = 0, prev = '';
  for (const ch of String(text || '').replace(/\s+/g, '')) { run = ch === prev ? run + 1 : 1; prev = ch; if (run > best) best = run; }
  return best;
}
/**
 * A run this long of ONE character is a loop, not a table (#5660 stress re-test: a rhyme table read as one line of
 * thousands of ○, which ocr-loop-guard cannot see — ○ is a symbol, and its units must carry a letter or digit).
 * The densest real cell runs seen in the SKQS numeric tables are ~12 (〇〇〇… in a zero column).
 */
export const MAX_CHAR_RUN = 40;

export function bodyHanCount(body) {
  return hanCount(String(body || '').replace(/<(header|page-num)>[\s\S]*?<\/\1>/g, ''));
}

/** Conversion 3: Paddle's HTML → lines. Returns { text, img, tables }. */
export function flattenHtml(raw) {
  let s = String(raw || '');
  const img = (s.match(/<img\b[^>]*>/gi) || []).length;
  const tables = (s.match(/<table\b/gi) || []).length;
  s = s.replace(/<img\b[^>]*>/gi, '')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<\/?(?:table|thead|tbody|tfoot|tr|td|th|div|span|p|center|b|i|u|br)\b[^>]*>/gi, (t) => (/^<br/i.test(t) ? '\n' : ''));
  return { text: s, img, tables };
}

/**
 * Conversions 2 and 3 on one raw Paddle read. Returns `{ body, stats }`: `body` is the page text
 * without the envelope (lines in Paddle's order), `stats` counts what was changed, for
 * `ocr.engine.postprocess`. `workTitle` (the book title before '·') lets a margin title line that
 * sits next to the 四庫全書 / juan lines be marked as a header too.
 */
export function convertPaddle(raw, { workTitle = null } = {}) {
  const html = flattenHtml(String(raw || '').normalize('NFC'));
  const stats = { img_dropped: html.img, tables_flattened: html.tables, kana_lines_dropped: 0, non_han_lines_dropped: 0, header_lines: 0, page_num_lines: 0 };
  // every line in Paddle's order, kept or not: a dropped kana line is where the fold strip was (the
  // 欽定四庫全書 column misread, measured 2026-10-02 on the #5600 pilot), so it still anchors the margin
  const seq = [];
  for (const line0 of html.text.split(/\r?\n/)) {
    const line = line0.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (KANA.test(line)) { stats.kana_lines_dropped++; seq.push({ kind: 'kana' }); continue; }
    if (!HAN.test(line)) { stats.non_han_lines_dropped++; continue; }
    seq.push({ kind: 'text', line, bare: line.replace(/\s/g, '') });
  }
  const wt = String(workTitle || '').normalize('NFC').replace(/\s/g, '');
  const isMarginHead = (b) => SKQS_LINE.test(b) || JUAN_LINE.test(b);
  // the fold strip abbreviates the title (御定佩文齋書畫譜 → 御定書畫譜): its characters in the title's order
  const inTitle = (b) => { if (!wt || b.length < 2) return false; let k = 0; for (const ch of wt) if (ch === b[k]) k++; return k === b.length; };
  const textIdx = seq.map((e, i) => (e.kind === 'text' ? i : -1)).filter((i) => i >= 0);
  const edge = new Set([...textIdx.slice(0, 4), ...textIdx.slice(-4)]);
  // the strip's title misread (欽定司事全書, 欽定曰事全書 on the pilot): short, at the page edge, still carrying 全書/四庫/欽定
  const garbledSkqs = (e, i) => edge.has(i) && e.bare.length >= 4 && e.bare.length <= 8 && /全書|四庫|^欽定/u.test(e.bare);
  const anchor = seq.map((e, i) => e.kind === 'kana' || (e.kind === 'text' && (isMarginHead(e.bare) || garbledSkqs(e, i))));
  const near = (i, marks, w = 3) => { for (let k = Math.max(0, i - w); k <= Math.min(seq.length - 1, i + w); k++) if (k !== i && marks[k]) return true; return false; };
  const leaf = seq.map((e) => e.kind === 'text' && LEAF_LINE.test(e.bare));
  const role = seq.map(() => null);
  seq.forEach((e, i) => {
    if (e.kind !== 'text') return;
    if (anchor[i]) role[i] = 'header';
    else if (edge.has(i) && (e.bare === wt || inTitle(e.bare)) && (near(i, anchor, 2) || (e.bare.length >= 3 && near(i, leaf, 2)))) role[i] = 'header';
  });
  const headOrAnchor = seq.map((e, i) => anchor[i] || role[i] === 'header');
  seq.forEach((e, i) => { if (e.kind === 'text' && !role[i] && LEAF_LINE.test(e.bare) && near(i, headOrAnchor)) role[i] = 'page-num'; });
  const out = [];
  seq.forEach((e, i) => {
    if (e.kind !== 'text') return;
    if (role[i] === 'header') { stats.header_lines++; out.push(`<header>${e.bare}</header>`); }
    else if (role[i] === 'page-num') { stats.page_num_lines++; out.push(`<page-num>${e.bare}</page-num>`); }
    else out.push(e.line);
  });
  return { body: out.join('\n'), stats };
}

/** Conversion 1: the in-text envelope consumers trust, as the Kraken and NDL lanes write it. */
export function envelope(body) {
  return `<language>Chinese</language>\n<script>handwritten</script>\n\n${String(body || '').trim()}`;
}

/** The work title a margin line can carry: the book title before '·' (記纂淵海·卷三十八 → 記纂淵海). */
export function workTitleOf(bookTitle) {
  const t = String(bookTitle || '').normalize('NFC');
  const i = t.indexOf('·');
  return (i > 0 ? t.slice(0, i) : '').trim() || null;
}

/** Page policy: `{ action: 'reocr'|'keep', why }`. A human edit is kept; everything else is read. */
export function pagePolicy(page, isHumanEditedFn) {
  if (isHumanEditedFn(page?.ocr)) return { action: 'keep', why: 'human_edited' };
  if (!page?.ocr?.data) return { action: 'reocr', why: 'first_write' };
  return { action: 'reocr', why: 'skqs_cohort' };
}

/**
 * The `$set` half of a page write. `text` is the ENVELOPED reading; `box` is what the box run
 * reported (box.json: versions, host, gpu, weights hash); `stats` the conversion counts.
 */
export function ocrSetFields(text, { run, now = new Date(), secs = null, imageUrl = null, box = {}, stats = null } = {}) {
  const stack = {
    paddleocr: box.paddleocr_version || PADDLE.stack.paddleocr,
    paddlex: box.paddlex_version || PADDLE.stack.paddlex,
    'paddlepaddle-gpu': box.paddle_version || PADDLE.stack['paddlepaddle-gpu'],
    source: box.paddleocr_version ? 'logged' : 'pinned (box did not report)',
  };
  return {
    'ocr.data': text,
    'ocr.content_hash': contentHash(text),
    'ocr.language': 'Chinese',
    'ocr.model': PADDLE.model,
    'ocr.source': 'paddle',
    'ocr.pipeline': LANE,
    'ocr.updated_at': now,
    'ocr.engine': {
      name: PADDLE.name, model: PADDLE.model, version: PADDLE.version, model_label: PADDLE.label,
      repo: PADDLE.repo, model_url: PADDLE.model_url, licence: PADDLE.licence, stack,
      ...(box.weights_sha256
        ? { revision: `sha256:${box.weights_sha256}`, revision_source: 'logged: sha256 of the weights file the box loaded' }
        : { revision_source: 'not_recorded: the box run did not hash the weights' }),
      conventions: PADDLE.conventions, postprocess: stats || null,
      run: run || LANE, issue: LANE_ISSUE, secs, host: box.host || null, gpu: box.gpu || null,
      // how the box served the model (#5600 benchmark: the vLLM server with N pipeline clients reads ≈ 9× the
      // native recipe at the same accuracy) — null for a box that did not report it
      serving: box.backend ? { backend: box.backend, runners: box.workers ?? null, vllm: box.vllm_version || null, max_side: box.max_side ?? null, layout: box.layout ?? null } : null,
      input: imageUrl ? { image_url: imageUrl } : { status: 'not_recorded', reason: 'caller passed no image url' },
    },
    updated_at: now,
  };
}
