#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-batch-continuity-ab.mjs (block SEAMS on a pinned
// 58-seam sample, not in-block boundaries, not corpus-wide); the page-seam walk behind
// lesson_continuity_context_sends_the_head_not_the_tail (scratch scripts/output/_seams.mjs,
// never committed — measured mid-sentence breaks, not where the text went); the scratch
// dupscan.mjs from #5026 (one book, over Atlas) — its 40-char-shingle longest-shared-run is
// ported here as sharedRun(). scripts/audit/* has nothing that compares a translation with the
// NEIGHBOURING page's source or translation.
/**
 * translation-page-boundaries — two defects at the page boundary of a translation, measured
 * over the local corpus mirror (~/sl-corpus/books/*.jsonl; never Atlas `pages`).
 *
 *   DRIFT (#5021)   page N+1's opening clause translated at the end of page N
 *                   (scripts/lib/block-drift.mjs detectBlockDrift).
 *   LEAK  (#5026)   page N's translation reproduced inside page N+1's — the continuity
 *                   context coming back as page text: consecutive translations share a run
 *                   of >= LEAK_MIN_CHARS after editorial blocks and tags are stripped. A pair
 *                   whose SOURCE pages share such a run too is counted apart (the book
 *                   repeats itself — a refrain, a repeated table).
 *
 * Block position is RECONSTRUCTED with translate-batch-seam planBlocks over each book's
 * translated pages in order — the partition a first full translation run would have used.
 * It is an approximation (a book translated in several runs, or re-translated in parts, has
 * other seams), reported as such: drift can only happen INSIDE a block, so a much lower rate
 * at reconstructed block starts is evidence the reconstruction and the mechanism both hold.
 *
 * Usage:
 *   node scripts/audit/translation-page-boundaries.mjs [--shard=k/n] [--limit=N]
 *        [--books=id,id] [--dir=~/sl-corpus/books] [--out=scripts/output/page-boundaries]
 * Writes <out>/shard-k.jsonl (one line per flagged pair) and <out>/shard-k.summary.json.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectBlockDrift } from '../lib/block-drift.mjs';

const MIN_OCR_CHARS_FOR_BLOCK = 200, BLOCK_SIZE = 8, MAX_BLOCK_OCR_CHARS = 20000; // translate-batch-seam mirrors
export const LEAK_MIN_CHARS = 200;
const NON_PROSE = new Set(['index', 'toc', 'title-page', 'illustration', 'blank', 'errata', 'diagram', 'frontispiece',
  'colophon', 'map', 'archived-spread', 'digitizer-insert', 'digitizer-notice', 'exlibris', 'bookplate', 'cover']);

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;

/** Same partition as translate-batch-seam planBlocks, on mirror rows ({ocr}). */
export function blockStarts(rows) {
  const starts = new Set();
  let i = 0;
  while (i < rows.length) {
    starts.add(rows[i].p);
    let size = 0;
    if ((rows[i].ocr || '').length >= MIN_OCR_CHARS_FOR_BLOCK) {
      let chars = 0;
      for (let j = i; j < Math.min(rows.length, i + BLOCK_SIZE); j++) {
        const len = (rows[j].ocr || '').length;
        if (len < MIN_OCR_CHARS_FOR_BLOCK) break;
        chars += len;
        if (chars > MAX_BLOCK_OCR_CHARS) break;
        size++;
      }
    }
    i += Math.max(1, size);
  }
  return starts;
}

const normTr = (t) => String(t || '')
  .replace(/<(meta|summary|keywords|vocab|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Longest run a and b share, found through 40-char shingles of b then extended (dupscan). */
export function sharedRun(a, b, min = LEAK_MIN_CHARS) {
  if (a.length < min || b.length < min) return { len: 0, text: '' };
  const K = 40, idx = new Map();
  for (let i = 0; i + K <= b.length; i += 8) { const s = b.slice(i, i + K); if (!idx.has(s)) idx.set(s, i); }
  let best = 0, bestA = -1;
  for (let i = 0; i + K <= a.length; i++) {
    const j = idx.get(a.slice(i, i + K)); if (j == null) continue;
    let back = 0; while (i - back > 0 && j - back > 0 && a[i - back - 1] === b[j - back - 1]) back++;
    let L = K; while (i + L < a.length && j + L < b.length && a[i + L] === b[j + L]) L++;
    if (L + back > best) { best = L + back; bestA = i - back; }
    i += Math.max(0, L - K); // skip what this match already covered
  }
  return { len: best, text: bestA >= 0 ? a.slice(bestA, bestA + Math.min(best, 200)) : '' };
}

function main() {
  const dir = arg('dir', path.join(os.homedir(), 'sl-corpus/books'));
  const out = arg('out', 'scripts/output/page-boundaries');
  const [k, n] = arg('shard', '0/1').split('/').map(Number);
  const limit = Number(arg('limit', 0));
  const only = arg('books', '') ? new Set(arg('books').split(',')) : null;
  fs.mkdirSync(out, { recursive: true });

  const lang = new Map();
  const booksIndex = path.join(path.dirname(dir), 'books.jsonl');
  if (fs.existsSync(booksIndex)) {
    for (const line of fs.readFileSync(booksIndex, 'utf8').split('\n')) {
      if (!line) continue;
      try { const b = JSON.parse(line); lang.set(b.id, b.language || 'unknown'); } catch {}
    }
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()
    .filter((f, i) => (only ? only.has(f.slice(0, -6)) : i % n === k));
  const flagged = fs.createWriteStream(path.join(out, `shard-${k}.jsonl`));
  const summary = { books: 0, booksTranslated: 0, byLang: {}, perBook: {} };
  const bucket = (l) => (summary.byLang[l] ||= { pairs: 0, inBlock: 0, blockStart: 0, eligible: 0, driftInBlock: 0, driftBlockStart: 0, leak: 0, leakSourceRepeat: 0, books: 0 });

  let done = 0;
  for (const f of files) {
    if (limit && done >= limit) break;
    done++;
    summary.books++;
    const id = f.slice(0, -6);
    let rows;
    try {
      rows = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    } catch { continue; }
    const tr = rows.filter(r => r.tr && r.tr.trim()).sort((a, b) => a.p - b.p);
    if (tr.length < 2) continue;
    summary.booksTranslated++;
    const l = lang.get(id) || 'unknown';
    const b = bucket(l); b.books++;
    const starts = blockStarts(tr);
    const pb = { pairs: 0, inBlock: 0, drift: 0, leak: 0 };
    for (let i = 0; i + 1 < tr.length; i++) {
      const A = tr[i], B = tr[i + 1];
      if (B.p !== A.p + 1) continue;
      b.pairs++; pb.pairs++;
      const inBlock = !starts.has(B.p);
      if (inBlock) { b.inBlock++; pb.inBlock++; } else b.blockStart++;

      // LEAK — every consecutive pair
      const leak = sharedRun(normTr(B.tr), normTr(A.tr));
      if (leak.len >= LEAK_MIN_CHARS) {
        const src = sharedRun(normTr(B.ocr), normTr(A.ocr));
        const sourceRepeats = src.len >= LEAK_MIN_CHARS;
        if (sourceRepeats) b.leakSourceRepeat++; else { b.leak++; pb.leak++; }
        flagged.write(JSON.stringify({ kind: 'leak', book: id, lang: l, prev: A.p, next: B.p, inBlock, len: leak.len, share: +(leak.len / Math.max(1, normTr(B.tr).length)).toFixed(3), sourceRepeats, text: leak.text }) + '\n');
      }

      // DRIFT — prose pages only
      if (NON_PROSE.has(A.type) || NON_PROSE.has(B.type)) continue;
      b.eligible++; if (inBlock) b.eligibleInBlock = (b.eligibleInBlock || 0) + 1;
      const d = detectBlockDrift({ ocrNext: B.ocr, trPrev: A.tr, trNext: B.tr });
      if (d.drift) {
        if (inBlock) { b.driftInBlock++; pb.drift++; } else b.driftBlockStart++;
        flagged.write(JSON.stringify({ kind: 'drift', book: id, lang: l, prev: A.p, next: B.p, inBlock, anchorVerdict: d.anchorVerdict, fragment: d.fragment.slice(0, 300) }) + '\n');
      }
    }
    summary.perBook[id] = pb;
    if (done % 2000 === 0) process.stderr.write(`shard ${k}: ${done}/${files.length}\n`);
  }
  flagged.end();
  fs.writeFileSync(path.join(out, `shard-${k}.summary.json`), JSON.stringify(summary));
  process.stderr.write(`shard ${k} done: ${summary.books} books, ${summary.booksTranslated} translated\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
