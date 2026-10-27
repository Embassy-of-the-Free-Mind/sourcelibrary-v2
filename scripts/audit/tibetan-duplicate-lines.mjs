#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/ocr-loop-corpus.mjs — the same walk shape (Atlas book by book, checkpointed, never
 * writes), but it measures an exact `(unit)^k` loop as a share of the page; an invented REPEATED LINE is one or two
 * near-copies of a sentence among real lines, far under its 0.30 floor. scripts/audit/dropped-line-candidates.mjs
 * needs two reads by different engines and does not judge Tibetan (no word spaces). duplicateScan()
 * (page-integrity.mjs) compares two PAGES, not two lines of one page.
 *
 * tibetan-duplicate-lines — list Tibetan pages whose stored OCR holds two lines that are near-copies (#6740, #4523).
 *
 * WHY. On Neyphug rGyud Tsha leaf 128 Yigdzin wrote 8 lines for a 7-line leaf, one sentence three times, and the
 * served English repeats it. The error reads fluently: nothing downstream fails. Scribes do repeat formulae, so this
 * is a WORKLIST whose precision was measured by eye against the images (see the experiment named in the PR).
 *
 * HOW. Model-free. Each line of `ocr.data` (tags out) is split into syllables (derge-tengyur.mjs `syllables`). Every
 * two lines are aligned locally, syllable by syllable (Smith-Waterman, +1/-1/-1): `score` is the length of the
 * longest stretch one line repeats from the other, net of misreads. A trigram-overlap screen (>= 50% of shared syllable
 * trigrams) was tried first and missed p.128 itself: Yigdzin's misreads differ every few syllables between the copies,
 * which breaks trigrams but not an alignment. Each row also carries `excess_lines`, the page's line count minus the
 * book's usual count for that kind of page (split leaf or whole frame): an invented line is usually one line too many.
 * Rows are written from --min-score (default 10, deliberately low); the calibrated flag rule is in the experiment.
 *
 * MEASURED PRECISION (2026-10-27, by eye against the images; experiments/2026-10-27-tibetan-duplicate-lines-6740.md):
 * the `flag` rule was tuned on 20 pages and then checked on 7 fresh ones: 2 of 6 decided were real. In the Kangyur's
 * formulaic sutras the LEAF itself repeats near-whole lines, and volumes mix 7- and 8-line leaves, so neither the
 * text nor the book's usual line count can tell an invented line from a scribe's. Flash, reading the image, dropped a
 * line of the flagged pair on 2 of 56 pilot pages. Use the output as a WORKLIST to look at, never as a write list.
 *
 * NEVER WRITES. Output: one JSON row per page with a pair over --min-score (--out, jsonl; `flag` marks the pages the
 * calibrated rule flags); per-book stats (--books-out, jsonl, which is
 * also the resume checkpoint: a book listed there is skipped on the next run).
 *
 *   node --env-file=.env.production.local scripts/audit/tibetan-duplicate-lines.mjs --out=$JOB_SCRATCH/dup.jsonl \
 *     --books-out=$JOB_SCRATCH/dup-books.jsonl [--book-id=ID[,ID]] [--limit-books=N] [--concurrency=4]
 *     [--min-score=10]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import { syllables } from '../lib/derge-tengyur.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
if (process.argv.includes('--apply')) { console.error('This script never writes.'); process.exit(2); }

const OUT = arg('out');
const BOOKS_OUT = arg('books-out');
const MIN_SCORE = Number(arg('min-score', '10'));
// The flag rule, calibrated by eye (#6740; see the experiment): the page has more lines than the book's usual count
// for its kind of page, AND two lines at most NEAR_GAP apart share a near-copy stretch of >= FLAG_SCORE syllables
// that covers >= FLAG_SHARE of the shorter line. A shared formula far apart, or a long-enough pair on a page with the
// usual line count, is reported in the jsonl but not flagged: those were the false positives of the first cut.
export const FLAG = { score: 15, share: 0.4, gap: 3, excess: 1 };
/** The near-copy pair the flag rule uses (best by share), or null. */
export function nearPair(pairs) {
  return pairs.filter((q) => q.j - q.i <= FLAG.gap && q.score >= FLAG.score && q.score / Math.min(...q.syl) >= FLAG.share)
    .sort((a, b) => b.score / Math.min(...b.syl) - a.score / Math.min(...a.syl))[0] ?? null;
}
const CONC = Number(arg('concurrency', '4'));
const BOOK_IDS = arg('book-id', '').split(',').filter(Boolean);
const LIMIT = Number(arg('limit-books', '0'));

/** The text lines of a transcription, tags removed, each with its syllables. */
export function textLines(data) {
  return String(data || '').replace(/<[^>\n]*>/g, '\n').split('\n')
    .map((t) => t.trim()).filter(Boolean).map((t) => ({ t, syl: syllables(t) }));
}

/** Best local alignment of two syllable arrays (Smith-Waterman: match +1, mismatch -1, gap -1). */
let rowA = new Int32Array(256); let rowB = new Int32Array(256);
export function localScore(a, b) {
  if (b.length + 1 > rowA.length) { rowA = new Int32Array(b.length + 1); rowB = new Int32Array(b.length + 1); }
  let prev = rowA.fill(0, 0, b.length + 1); let cur = rowB; let best = 0;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = 0;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.max(0, prev[j - 1] + (a[i - 1] === b[j - 1] ? 1 : -1), prev[j] - 1, cur[j - 1] - 1);
      cur[j] = v; if (v > best) best = v;
    }
    const t = prev; prev = cur; cur = t;
  }
  return best;
}

/** How many syllables two arrays share as multisets: an upper bound on localScore, used to skip pairs cheaply. */
function sharedCount(a, b) {
  const m = new Map(); for (const s of a) m.set(s, (m.get(s) || 0) + 1);
  let k = 0; for (const s of b) { const v = m.get(s); if (v) { k++; m.set(s, v - 1); } }
  return k;
}

/**
 * Every pair of lines on the page whose best local alignment scores >= minScore, best first. `score` is the length,
 * net of mismatches and gaps, of the longest stretch one line repeats from the other: a copied sentence scores high
 * through OCR noise; a formula shared by two lines (a refrain, a list item) scores its own few syllables.
 */
export function duplicatePairs(data, { minScore = MIN_SCORE } = {}) {
  const lines = textLines(data);
  const pairs = [];
  for (let x = 0; x < lines.length; x++) for (let y = x + 1; y < lines.length; y++) {
    const a = lines[x].syl; const b = lines[y].syl;
    if (a.length < minScore || b.length < minScore || sharedCount(a, b) < minScore) continue;
    const score = localScore(a, b);
    if (score < minScore) continue;
    pairs.push({ i: x, j: y, score, syl: [a.length, b.length], a: lines[x].t, b: lines[y].t });
  }
  pairs.sort((p, q) => q.score - p.score);
  return { lines: lines.length, pairs };
}

async function main() {
  if (!OUT || !BOOKS_OUT) { console.error('need --out and --books-out'); process.exit(2); }
  const c = new MongoClient(process.env.MONGODB_URI, { compressors: ['zlib'], serverSelectionTimeoutMS: 60000 });
  await c.connect();
  const db = c.db('bookstore');
  const q = BOOK_IDS.length ? { id: { $in: BOOK_IDS } } : { $or: [{ language: /tibetan/i }, { original_language: /tibetan/i }] };
  let books = await db.collection('books').find(q, { projection: { id: 1, title: 1, visible: 1, pages_count: 1, read_count: 1, 'pipeline_auto.status': 1 } }).toArray();
  // Public books first, then the rest; inside each, the most pages first (the long Kangyur volumes).
  books.sort((a, b) => (!!b.visible - !!a.visible) || ((b.pages_count || 0) - (a.pages_count || 0)) || a.id.localeCompare(b.id));
  const done = new Set(fs.existsSync(BOOKS_OUT) ? fs.readFileSync(BOOKS_OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).book_id) : []);
  if (LIMIT) books = books.slice(0, LIMIT);
  const todo = books.filter((b) => !done.has(b.id));
  console.log(`${books.length} books, ${done.size} already walked, ${todo.length} to go`);
  const out = fs.createWriteStream(OUT, { flags: 'a' });
  const bout = fs.createWriteStream(BOOKS_OUT, { flags: 'a' });
  let n = 0; const t0 = Date.now();
  const tot = { pages: 0, judged: 0, flagged: 0, served: 0, flag: 0, flag_served: 0 };
  async function one(b) {
    const ps = await db.collection('pages').find({ book_id: b.id, 'ocr.data': { $type: 'string', $ne: '' } }, {
      projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1, 'ocr.content_hash': 1,
        'ocr.edited_by': 1, 'ocr.pipeline': 1, split_from_leaf_order: 1,
        served: { $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 0] } },
      maxTimeMS: 600000,
    }).toArray();
    // The book's usual line count, per kind of page (a split leaf vs a whole frame): an invented line shows as one more.
    const lineCounts = { split: {}, frame: {} }; const rows = []; let judged = 0;
    for (const p of ps) {
      const { lines, pairs } = duplicatePairs(p.ocr.data);
      const kind = p.split_from_leaf_order ? 'split' : 'frame';
      lineCounts[kind][lines] = (lineCounts[kind][lines] || 0) + 1;
      if (lines >= 2) judged++;
      const best = pairs[0];
      if (!best) continue;
      const near = nearPair(pairs);
      rows.push({ near: near && { i: near.i, j: near.j, score: near.score, share: +(near.score / Math.min(...near.syl)).toFixed(2), a: near.a, b: near.b }, page_id: p.id, book_id: b.id, page_number: p.page_number, visible: !!b.visible, source: p.ocr.source ?? null,
        model: p.ocr.model ?? null, pipeline: p.ocr.pipeline ?? null, edited_by: p.ocr.edited_by ?? null, content_hash: p.ocr.content_hash ?? null,
        split: !!p.split_from_leaf_order, served_english: !!p.served, lines, best, pairs: pairs.slice(0, 3).map(({ a, b: bb, ...r }) => r) });
    }
    const modeOf = (h) => { const e = Object.entries(h).sort((x, y) => y[1] - x[1])[0]; return e ? Number(e[0]) : null; };
    const mode = { split: modeOf(lineCounts.split), frame: modeOf(lineCounts.frame) };
    for (const r of rows) {
      r.book_mode_lines = mode[r.split ? 'split' : 'frame'];
      r.excess_lines = r.book_mode_lines == null ? null : r.lines - r.book_mode_lines;
      r.flag = !!r.near && r.excess_lines != null && r.excess_lines >= FLAG.excess;
      out.write(JSON.stringify(r) + '\n');
    }
    const st = { book_id: b.id, title: b.title, visible: !!b.visible, pages: ps.length, judged, flagged: rows.length,
      flagged_served: rows.filter((r) => r.served_english).length, mode_lines: mode,
      flag: rows.filter((r) => r.flag).length, flag_served: rows.filter((r) => r.flag && r.served_english).length };
    bout.write(JSON.stringify(st) + '\n');
    tot.pages += ps.length; tot.judged += judged; tot.flagged += rows.length; tot.served += st.flagged_served; tot.flag += st.flag; tot.flag_served += st.flag_served;
    if (++n % 25 === 0) console.log(`${n}/${todo.length} books ${tot.pages} pages ${tot.flagged} rows, ${tot.flag} flagged (${tot.flag_served} served English) ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  let k = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (k < todo.length) {
      const b = todo[k++];
      for (let attempt = 1; ; attempt++) {
        try { await one(b); break; } catch (e) {
          if (attempt >= 3) { console.error(`SKIP ${b.id}: ${e.message}`); break; }
          await new Promise((r) => setTimeout(r, 5000 * attempt));
        }
      }
    }
  }));
  await new Promise((r) => out.end(r)); await new Promise((r) => bout.end(r));
  console.log(`done: ${n} books this run, ${tot.pages} pages, ${tot.flagged} rows, ${tot.flag} flagged, ${tot.flag_served} flagged with served English`);
  await c.close();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
