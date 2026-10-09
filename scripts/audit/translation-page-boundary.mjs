#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-page-boundaries.mjs (LEAK ≥200-char runs + DRIFT per pair,
// over the ~/sl-corpus mirror, which is not on this box, and never scored against a labelled set);
// scripts/audit/translation-bridging.mjs (four page-level signals scored against ALL 36 audit
// inventions, P 0.25 — its target is any bridging, not text that belongs to a neighbour, and it
// has no lane/model provenance); scripts/lib/block-drift.mjs (detectBlockDrift, sourceProse,
// translationProse — reused here unchanged). None measures in WORDS, so none sees a short verbatim duplicate
// ("as they seemed to want to do at the mere sight of his fleet out of fear" on both leaves), and
// none can stratify by the lane that wrote the page. scripts/eval/lib/agreement-stats.mjs wilson.
/**
 * translation-page-boundary — does a page's English carry text that belongs to the ADJACENT page?
 * (#3918). $0: Mongo reads only, no model.
 *
 * Signals for page N, each reported separately (N-1 / N+1 may be absent):
 *
 *   dupNext   N's English and N+1's share a run of ≥ MIN_DUP_WORDS normalised words, within
 *             EDGE_WORDS of both facing edges (or ≥ COPY_WORDS anywhere)
 *   dupPrev   the same against N-1
 *             — both refused when the two SOURCES share a run too (sourcesRepeat: a refrain, a
 *             formula, a repeated table row — the text rendered twice, not a copy).
 *   carried   N+1's source opens mid-sentence, N+1's English opens fresh, N's English closes
 *             (block-drift.mjs detectBlockDrift steps 1–4), and N's English/source ratio is
 *             ≥ CARRIED_REL × its neighbours' — N+1's opening was translated on N.
 *   ocrNext   N's last half renders N+1's SOURCE head verbatim (≥ MIN_OCR_WORDS words not in N's
 *             own source) — the only cross-page test for an English source or a quoted passage.
 *   anchorsNext / anchorsPrev
 *             ≥ MIN_ANCHORS numerals / proper names from the neighbour's source edge (N+1's head,
 *             N-1's tail) in N's English edge, absent from N's own source.
 *
 * Calibrated (--calibrate) against the #5274 audit's 311 served pages: positives are the 13
 * page-boundary imports confirmed against the adjacent page's OCR (PR #5622,
 * scripts/eval/experiments/2026-10-02-what-the-judge-calls-invention-5274.md); every other page
 * is a negative (0b1479907c, the unconfirmed one, is left out). Numbers: the experiment file
 * scripts/eval/experiments/2026-10-02-translation-page-boundary-3918.md.
 *
 * MEASURED 2026-10-02 (#3918):
 *   calibration   any: 11 flagged, P 0.55 (9/11 at pair level: 3 "negatives" are the neighbour's
 *                 defect, which the judge never saw), R 0.46 (6/13; majors 5/8). Misses: sub-clause
 *                 completions, an import inside <meta>, a caseless-script page.
 *   corpus        1,800 books, one page each: 79 flags, read by hand (text) → 44 real, 27 false,
 *                 8 unclear (P 0.56). Verified 2.44% of served pages (1.83–3.27). False flags are
 *                 refrains the source spells differently (u/v, transliteration), facing-translation
 *                 editions, index page numbers — anchorsNext is the weakest signal (3/9).
 * A flag is a work list; verify before acting on it.
 *
 * Lane, read off each page (attributeLane):
 *   engine.call_site       written by every translation writer since #4613 (2026-09-28)
 *   translate_batch_runs   chained Batch lane (mode 'chained', 2026-09-29 →), page in a run queue
 *   batch_jobs             the Batch route (src/app/api/books/[id]/batch-translate-async), page_ids
 *   otherwise              'realtime-unattributed': the realtime translate-worker (8-page blocks
 *                          since 2026-03-28) or an older script — no provenance says which.
 *
 * Usage (read-only; node --env-file=.env.production.local):
 *   node scripts/audit/translation-page-boundary.mjs --calibrate
 *   node scripts/audit/translation-page-boundary.mjs --sample=1800 [--seed=3918]
 * Writes to --out (default scripts/output/translation-page-boundary/). Files no issues
 * (measurement-instruments.md): a work list and a rate, never a verdict on a page.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { detectBlockDrift, sourceProse, translationProse } from '../lib/block-drift.mjs';
import { wilson } from '../eval/lib/agreement-stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.join(HERE, '../eval/results/translation-corpus-audit-2026-09-30');

export const MIN_DUP_WORDS = 8;
// A duplicate sits at the FACING edges: within EDGE_WORDS of N's boundary and of the neighbour's.
// A run of COPY_WORDS anywhere is a copied passage whatever its position (740bb56281: a whole
// meditation from the previous page).
export const EDGE_WORDS = 60;
export const COPY_WORDS = 40;
export const MIN_OCR_WORDS = 6;
export const MIN_ANCHORS = 2;
export const SOURCE_REPEAT_TOKENS = 6;
// Spaceless scripts (Han, kana): the source-repeat test runs on characters, not words.
export const SOURCE_REPEAT_CHARS = 8;
// carried: N's English/source ratio this far above its neighbours' (positives 1.14–1.60, see the
// experiment file; 1.15 is the round number below the bulk of them, chosen before the corpus run).
export const CARRIED_REL = 1.15;
// #5103 PAGE_BREAK_SCOPED went live on the realtime worker with 8fc2ec97e (2026-09-26).
export const PAGE_BREAK_LIVE = new Date('2026-09-26T00:00:00Z');
const NON_PROSE = new Set(['index', 'toc', 'title-page', 'illustration', 'blank', 'errata', 'diagram', 'frontispiece',
  'colophon', 'map', 'archived-spread', 'digitizer-insert', 'digitizer-notice', 'exlibris', 'bookplate', 'cover', 'table']);
// The audit's positives (PR #5622). 8ad1bca178 is a hyphen completion (στα-|σιάσαντα); kept, as the brief says 13.
export const CONFIRMED = ['1dfa95a297', '9242725390', '7c34ba73d6', 'ed9643dcf5', '52e056e34f', '630e34eb2f', 'bbad675645',
  '485571afa2', '8ad1bca178', '018aef589b', '545f9fcf4b', '61d9ea9855', '740bb56281'];
const UNCONFIRMED = new Set(['0b1479907c']);

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const flag = (k) => process.argv.includes(`--${k}`);

/** Lowercase, diacritics folded, letters and digits only. */
export const words = (t) => String(t || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const trWords = (tr) => words(translationProse(tr));
const srcWords = (ocr) => words(sourceProse(ocr));

/** Longest run of consecutive words a and b share (seeded on minN-grams of b), as { len, text }. */
export function longestWordRun(a, b, minN) {
  if (a.length < minN || b.length < minN) return { len: 0, text: '' };
  const idx = new Map();
  for (let j = 0; j + minN <= b.length; j++) {
    const k = b.slice(j, j + minN).join(' ');
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(j);
  }
  let best = 0, at = -1, atB = -1;
  for (let i = 0; i + minN <= a.length; i++) {
    const js = idx.get(a.slice(i, i + minN).join(' '));
    if (!js) continue;
    for (const j of js) {
      let L = minN;
      while (i + L < a.length && j + L < b.length && a[i + L] === b[j + L]) L++;
      if (L > best) { best = L; at = i; atB = j; }
    }
  }
  return { len: best, i: at, j: atB, text: at >= 0 ? a.slice(at, at + Math.min(best, 40)).join(' ') : '' };
}

const half = (w, side) => side === 'tail' ? w.slice(Math.floor(w.length / 2)) : w.slice(0, Math.ceil(w.length / 2));

/** Numerals (≥2 digits) and capitalised words (≥4 letters, not sentence-initial) — tokens that survive translation. */
function anchors(text) {
  const out = new Set();
  for (const m of text.matchAll(/\p{N}{2,}/gu)) out.add(m[0]);
  const ws = text.split(/\s+/);
  ws.forEach((w, i) => {
    const word = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    if (i > 0 && !/[.!?]$/u.test(ws[i - 1]) && word.length >= 4 && /^\p{Lu}\p{Ll}/u.test(word)) out.add(word);
  });
  return [...out];
}
const EDGE_CHARS = 300;
function anchorsCarried(neighbourOcr, side, pageOcr, pageTr) {
  const src = sourceProse(neighbourOcr).replace(/\s+/g, ' ');
  const edge = side === 'head' ? src.slice(0, EDGE_CHARS) : src.slice(-EDGE_CHARS);
  const own = sourceProse(pageOcr), tr = translationProse(pageTr).replace(/\s+/g, ' ');
  const trEdge = side === 'head' ? tr.slice(Math.floor(tr.length * 0.6)) : tr.slice(0, Math.ceil(tr.length * 0.4));
  const ownFolded = own.normalize('NFKD').replace(/\p{M}/gu, '');
  return anchors(edge).filter(a => !ownFolded.includes(a.normalize('NFKD').replace(/\p{M}/gu, '')) && trEdge.includes(a));
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const spaceless = (t) => { const n = (t.match(/\p{L}/gu) || []).length; return n > 0 && (t.match(CJK) || []).length / n > 0.3; };
/**
 * Do the two SOURCES share a run — a refrain, a formula, a repeated table row, a running head?
 * Then a run their translations share is the text rendered twice, not a copy. Words are folded
 * (diacritics and harakat stripped, so إِلَهَ = اِلَهَ); spaceless scripts compare characters.
 */
export function sourcesRepeat(ocrA, ocrB) {
  const a = sourceProse(ocrA), b = sourceProse(ocrB);
  if (spaceless(a) || spaceless(b)) {
    const ca = [...a.replace(/[^\p{L}\p{N}]/gu, '')], cb = [...b.replace(/[^\p{L}\p{N}]/gu, '')];
    return longestWordRun(ca, cb, SOURCE_REPEAT_CHARS).len >= SOURCE_REPEAT_CHARS;
  }
  return longestWordRun(words(a), words(b), SOURCE_REPEAT_TOKENS).len >= SOURCE_REPEAT_TOKENS;
}

const letters = (t) => (String(t).match(/[\p{L}\p{N}]/gu) || []).length;
const ratioOf = (pg) => { const s = letters(sourceProse(pg?.ocr)); return pg?.tr && s >= 80 ? letters(translationProse(pg.tr)) / s : null; };

/**
 * A duplicated run between page N and a neighbour. side 'next': N's text against N+1's;
 * 'prev': N's against N-1's. Returns the run with its distance from each facing edge, or null.
 */
function edgeDuplicate(w, nbTr, side) {
  const b = trWords(nbTr);
  const run = longestWordRun(w, b, MIN_DUP_WORDS);
  if (run.len < MIN_DUP_WORDS) return null;
  const distN = side === 'next' ? w.length - (run.i + run.len) : run.i;
  const distNb = side === 'next' ? run.j : b.length - (run.j + run.len);
  const atEdge = distN <= EDGE_WORDS && distNb <= EDGE_WORDS;
  return atEdge || run.len >= COPY_WORDS ? { len: run.len, distN, distNb, text: run.text } : null;
}

/** Every signal for page N. page/prev/next: { ocr, tr, type } (prev/next may be null). */
export function boundarySignals({ page, prev, next }) {
  const s = { dupNext: false, dupPrev: false, carried: false, ocrNext: false, anchorsNext: false, anchorsPrev: false, sourceRepeat: false };
  const w = trWords(page.tr);
  if (w.length < 20) return { ...s, any: false, skipped: 'short' };
  const prose = !NON_PROSE.has(page.type);
  if (next?.tr) {
    const d = edgeDuplicate(w, next.tr, 'next');
    if (d) { if (sourcesRepeat(page.ocr, next.ocr)) s.sourceRepeat = true; else { s.dupNext = true; s.dupNextRun = d; } }
    // carried: N+1's source opens mid-sentence, its English opens on a fresh sentence, N's English
    // closes — block-drift.mjs steps 1–4 — and N's English is long for its source against both
    // neighbours. block-drift's own step 5 (absorbedShare) measures only N's LAST sentence; an
    // import of several sentences scores ~0 there (1dfa95a297 0.30, 630e34eb2f 0.11, 485571afa2 0.04).
    if (prose && !NON_PROSE.has(next.type)) {
      const d4 = detectBlockDrift({ ocrPrev: page.ocr, ocrNext: next.ocr, trPrev: page.tr, trNext: next.tr, minAbsorbed: -Infinity });
      const rN = ratioOf(page), ref = [ratioOf(next), ratioOf(prev)].filter(x => x != null);
      const rel = rN != null && ref.length ? rN / (ref.reduce((a, b) => a + b, 0) / ref.length) : null;
      if (d4.drift && rel != null && rel >= CARRIED_REL) { s.carried = true; s.carriedRel = +rel.toFixed(2); s.carriedFragment = d4.fragment.slice(0, 200); }
    }
  }
  if (prev?.tr) {
    const d = edgeDuplicate(w, prev.tr, 'prev');
    if (d) { if (sourcesRepeat(prev.ocr, page.ocr)) s.sourceRepeat = true; else { s.dupPrev = true; s.dupPrevRun = d; } }
  }
  if (next?.ocr) {
    const own = new Set(srcWords(page.ocr).map((x, i, a) => a.slice(i, i + MIN_OCR_WORDS).join(' ')));
    const run = longestWordRun(half(w, 'tail'), srcWords(next.ocr).slice(0, 80), MIN_OCR_WORDS);
    // A run the page's own source also carries is the page's text, not its neighbour's.
    if (run.len >= MIN_OCR_WORDS && !own.has(run.text.split(' ').slice(0, MIN_OCR_WORDS).join(' '))) { s.ocrNext = true; s.ocrNextText = run.text; }
    const a = anchorsCarried(next.ocr, 'head', page.ocr, page.tr);
    if (a.length >= MIN_ANCHORS) { s.anchorsNext = true; s.anchorsNextList = a.slice(0, 8); }
  }
  if (prev?.ocr) {
    const a = anchorsCarried(prev.ocr, 'tail', page.ocr, page.tr);
    if (a.length >= MIN_ANCHORS) { s.anchorsPrev = true; s.anchorsPrevList = a.slice(0, 8); }
  }
  s.dup = s.dupNext || s.dupPrev;
  s.any = s.dup || s.carried || s.ocrNext || s.anchorsNext || s.anchorsPrev;
  return s;
}
export const SIGNALS = ['dupNext', 'dupPrev', 'dup', 'carried', 'ocrNext', 'anchorsNext', 'anchorsPrev', 'any'];

// ── Mongo ────────────────────────────────────────────────────────────────────
const PAGE_PROJ = { _id: 0, id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1,
  'translation.updated_at': 1, 'translation.prompt_version': 1, 'translation.source': 1, 'translation.engine.call_site': 1,
  'translation.engine.api': 1, 'translation.engine.input.context': 1 };
const asPage = (r) => r && ({ id: r.id, p: r.page_number, type: r.page_type, ocr: r.ocr?.data || '', tr: r.translation?.data || '',
  model: r.translation?.model || null, at: r.translation?.updated_at || null, pv: r.translation?.prompt_version || null,
  src: r.translation?.source || null, callSite: r.translation?.engine?.call_site || null, api: r.translation?.engine?.api || null,
  ctx: r.translation?.engine?.input?.context || null });

async function fetchTriple(db, bookId, n) {
  const rows = await db.collection('pages').find({ book_id: bookId, page_number: { $in: [n - 1, n, n + 1] } }, { projection: PAGE_PROJ }).toArray();
  const by = new Map(rows.map(r => [r.page_number, asPage(r)]));
  return { prev: by.get(n - 1) || null, page: by.get(n) || null, next: by.get(n + 1) || null };
}

/** Lane indexes: page id → lane, from the run/job collections (both small). */
async function laneIndex(db) {
  const chained = new Set(), batchRoute = new Map();
  for await (const r of db.collection('translate_batch_runs').find({ mode: 'chained', shadow: { $ne: true } }, { projection: { queue: 1, blocks: 1 } })) {
    for (const q of r.queue || []) chained.add(q.id);
    for (const b of r.blocks || []) for (const p of b.pages || []) chained.add(p.id);
  }
  for await (const j of db.collection('batch_jobs').find({ type: 'translation' }, { projection: { page_ids: 1, created_at: 1 } })) {
    for (const id of j.page_ids || []) batchRoute.set(id, j.created_at);
  }
  return { chained, batchRoute };
}
export function attributeLane(page, idx) {
  const cs = page.callSite || '';
  if (/translate-batch-chained/.test(cs)) return 'batch-chained';
  if (/translate-batch-seam|translate-batch-worker/.test(cs)) return 'batch-seam';
  if (/translate-worker/.test(cs)) return 'realtime-worker';
  if (/batch-translate-async|batch-collector/.test(cs)) return 'batch-route';
  if (cs) return `other:${cs.split('/').pop()}`;
  if (idx?.chained.has(page.id)) return 'batch-chained';
  const at = idx?.batchRoute.get(page.id);
  if (at && page.at && new Date(page.at) >= new Date(at)) return 'batch-route';
  return 'realtime-unattributed';
}

// ── --calibrate ──────────────────────────────────────────────────────────────
async function calibrate(db, out) {
  const man = fs.readFileSync(path.join(AUDIT_DIR, 'manifest.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(m => m.kind === 'main');
  const items = new Map(fs.readFileSync(path.join(AUDIT_DIR, 'items.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(x => [x.id, x]));
  const pos = new Set(CONFIRMED), rows = [];
  for (const m of man) {
    if (UNCONFIRMED.has(m.id)) continue;
    const t = await fetchTriple(db, m.book_id, m.page_number);
    // Score what the JUDGE saw for page N; the neighbours are as they are in Mongo now.
    const it = items.get(m.id);
    const page = { ocr: it.source, tr: it.translation, type: m.page_type };
    const s = boundarySignals({ page, prev: t.prev, next: t.next });
    rows.push({ id: m.id, book: m.book_id, p: m.page_number, lang: m.language, arm: m.arm, positive: pos.has(m.id), ...s });
  }
  const report = { pages: rows.length, positives: rows.filter(r => r.positive).length, signals: {} };
  for (const k of SIGNALS) {
    const tp = rows.filter(r => r[k] && r.positive).length, fp = rows.filter(r => r[k] && !r.positive).length;
    report.signals[k] = { flagged: tp + fp, tp, fp, precision: tp + fp ? +(tp / (tp + fp)).toFixed(2) : null, recall: +(tp / report.positives).toFixed(2),
      hits: rows.filter(r => r[k] && r.positive).map(r => r.id), falsePositives: rows.filter(r => r[k] && !r.positive).map(r => r.id) };
  }
  fs.writeFileSync(path.join(out, 'calibrate-rows.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'calibrate.json'), JSON.stringify(report, null, 2) + '\n');
  for (const [k, v] of Object.entries(report.signals)) console.log(`${k.padEnd(12)} flagged ${String(v.flagged).padStart(3)}  P ${v.precision ?? '—'}  R ${v.recall}  (${v.tp}/${report.positives})`);
}

// ── --sample ─────────────────────────────────────────────────────────────────
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const SERVED = { visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 1 } };

async function sample(db, out, n, seed) {
  const r = rng(seed);
  const idx = await laneIndex(db);
  // $sample has no seed; the draw is recorded instead (the sample file) so it can be re-scored.
  const books = await db.collection('books').aggregate([{ $match: SERVED }, { $sample: { size: Math.ceil(n * 1.4) } },
    { $project: { _id: 0, id: 1, language: 1, pages_translated: 1 } }], { maxTimeMS: 120000 }).toArray();
  // Resumable: rows already in the sample file stay; their books are not drawn again (one page per book).
  const file = path.join(out, `sample-${seed}.jsonl`);
  const drawn = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const seen = new Set(drawn.map(x => x.book));
  const w = fs.createWriteStream(file, { flags: 'a' });
  for (const b of books) {
    if (drawn.length >= n) break;
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    // Page numbers of translated pages only (no text) — then ONE drawn, its neighbours fetched.
    const nums = await db.collection('pages').find({ book_id: b.id, 'translation.data': { $exists: true, $nin: [null, ''] } },
      { projection: { _id: 0, page_number: 1 } }).toArray();
    const have = new Set(nums.map(x => x.page_number));
    const cand = nums.map(x => x.page_number).filter(p => p > 0 && (have.has(p - 1) || have.has(p + 1)));
    if (!cand.length) continue;
    const p = cand[Math.floor(r() * cand.length)];
    const t = await fetchTriple(db, b.id, p);
    if (!t.page?.tr) continue;
    const s = boundarySignals(t);
    if (s.skipped) continue;
    const lane = attributeLane(t.page, idx);
    const row = { book: b.id, p, lang: b.language || 'unknown', pagesTranslated: b.pages_translated, lane, model: t.page.model, pv: t.page.pv,
      at: t.page.at, afterFix: t.page.at ? new Date(t.page.at) >= PAGE_BREAK_LIVE : null, pageBreak: t.page.ctx?.page_break ?? null,
      block: t.page.ctx?.block?.pages ?? null, hasPrev: !!t.prev?.tr, hasNext: !!t.next?.tr, url: `https://sourcelibrary.org/book/${b.id}?page=${p}`, ...s };
    drawn.push(row); w.write(JSON.stringify(row) + '\n');
    if (drawn.length % 100 === 0) process.stderr.write(`${drawn.length}/${n}\n`);
  }
  w.end();
  const totals = await db.collection('books').aggregate([{ $match: SERVED }, { $group: { _id: null, books: { $sum: 1 }, pages: { $sum: '$pages_translated' } } }], { maxTimeMS: 120000 }).toArray();
  const summary = summarise(drawn, totals[0]);
  summary.seed = seed;
  fs.writeFileSync(path.join(out, `summary-${seed}.json`), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary.overall, null, 2));
}

const rate = (k, n) => { const [lo, hi] = wilson(k, n); return { k, n, rate: n ? +(k / n).toFixed(4) : null, lo: +lo.toFixed(4), hi: +hi.toFixed(4) }; };
export function summarise(rows, totals) {
  const strat = (keyFn) => {
    const g = {};
    for (const x of rows) (g[keyFn(x)] ||= []).push(x);
    return Object.fromEntries(Object.entries(g).sort((a, b) => b[1].length - a[1].length)
      .map(([k, xs]) => [k, Object.fromEntries(['any', 'dup', 'carried', 'ocrNext', 'anchorsNext', 'anchorsPrev'].map(s => [s, rate(xs.filter(x => x[s]).length, xs.length)]))]));
  };
  // Page-weighted: each book stands for its pages_translated pages (a random PAGE, not a random book).
  const W = rows.reduce((a, x) => a + (x.pagesTranslated || 0), 0), Wany = rows.filter(x => x.any).reduce((a, x) => a + (x.pagesTranslated || 0), 0);
  const overall = { books: rows.length, perBook: rate(rows.filter(x => x.any).length, rows.length), pageWeighted: W ? +(Wany / W).toFixed(4) : null,
    servedTranslatedPages: totals?.pages ?? null, servedTranslatedBooks: totals?.books ?? null };
  for (const s of SIGNALS) overall[s] = rate(rows.filter(x => x[s]).length, rows.length);
  return {
    overall,
    byLane: strat(x => x.lane),
    byModel: strat(x => x.model || 'unknown'),
    byEra: strat(x => x.afterFix == null ? 'unknown' : x.afterFix ? 'after-2026-09-26' : 'before-2026-09-26'),
    byLaneEra: strat(x => `${x.lane} | ${x.afterFix == null ? '?' : x.afterFix ? 'after' : 'before'}`),
    byPageBreakCtx: strat(x => x.pageBreak ?? 'none-recorded'),
    byLang: strat(x => x.lang),
  };
}

async function main() {
  const out = arg('out', 'scripts/output/translation-page-boundary');
  fs.mkdirSync(out, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  try {
    if (flag('calibrate')) await calibrate(db, out);
    else if (arg('sample')) await sample(db, out, Number(arg('sample')), Number(arg('seed', 3918)));
    else console.error('usage: --calibrate | --sample=N [--seed=S]');
  } finally { await client.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
