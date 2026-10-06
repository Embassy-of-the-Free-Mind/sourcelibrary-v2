#!/usr/bin/env node
// #6012 steps 3b–4: read both sides and decide. For each candidate pair (match.mjs) a seeded sample of
// our pages is located in the typed text by k-gram offset voting; a pair whose pages are found gets every
// page aligned, and the typed text's own page breaks decide the kind:
//   same-edition              our page spans start and end where the typed text's <pb> do
//   same-work-other-edition   the text is found, the page breaks fall elsewhere
//   (rejected)                the text is not found: the catalogue fields agreed and the books differ
// READ-ONLY on Mongo (`pages.ocr.data`, projection). $0, no model call. Nothing is written to Mongo.
//
// PRIOR ART: scripts/eval/ground-truth-5935/pali.mjs `locate` (k-gram offset voting by indexOf over one
//   long stream, with a runner-up) — ported below with the same thresholds, because that file is a CLI
//   with side effects on import; scripts/lib/sefaria-fit.mjs `locate` builds a Map index per text, which
//   for a 10M-letter DTA volume costs more memory than the box may use. `bodyText`, `periodOf` and
//   `engineOf` are imported from ground-truth-5935/lib.mjs. #5126's builder (job-local) confirmed <pb>
//   congruence on one page per book by eye; here it is computed for every page.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/typed-refs-6012/align.mjs --source=dta|camena|eebo-tcp [--limit=N]
// Writes <work>/<dir>/pairs.jsonl (one row per candidate pair) and <work>/<dir>/aligned-pages.jsonl.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { bodyText, periodOf, engineOf } from '../ground-truth-5935/lib.mjs';
import { argOf, foldLatin, PARSE_VERSION } from './lib.mjs';

export const ALIGN_VERSION = 'kgram-vote-v1';   // K, thresholds and the span rule below; change any → bump
const K = 12, GRAMS = 48, BUCKET_W = 64;
const SEED = 6012;
const SOURCE = argOf('source');
const WORK = argOf('work', '/data/scratch/sl/typed-refs-6012');
const LIMIT = Number(argOf('limit', '0'));
const dirOf = { dta: 'dta', camena: 'camena', 'eebo-tcp': 'eebo' }[SOURCE];
const DIR = path.join(WORK, dirOf);
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ── locate (ported from ground-truth-5935/pali.mjs) ─────────────────────────
function locate(Q, Lfull, { lo = 0, hi = Infinity, k = K, grams = GRAMS } = {}) {
  const n = Q.length - k;
  if (n < 20) return null;
  // A window is cut as a substring: indexOf cannot stop early, and a missing gram would scan to the end.
  const base = Math.max(0, lo), L = base > 0 || hi < Lfull.length ? Lfull.slice(base, Math.min(Lfull.length, hi)) : Lfull;
  const step = Math.max(1, Math.floor(n / grams));
  const votes = new Map();
  let asked = 0;
  for (let j = 0; j <= n; j += step) {
    const g = Q.slice(j, j + k);
    asked++;
    let p = L.indexOf(g), hits = 0;
    const seen = [];
    while (p >= 0 && hits < 30) { seen.push(p); hits++; p = L.indexOf(g, p + 1); }
    if (hits >= 30) continue;                       // a stock phrase carries no location
    for (const q of seen) { const b = Math.round((q - j) / BUCKET_W); votes.set(b, (votes.get(b) || 0) + 1); }
  }
  if (!votes.size) return { pos: null, share: 0, second: 0 };
  const sum = (b) => (votes.get(b - 1) || 0) + (votes.get(b) || 0) + (votes.get(b + 1) || 0);
  let best = null, bv = -1;
  for (const b of votes.keys()) { const v = sum(b); if (v > bv) { bv = v; best = b; } }
  let second = 0;
  for (const b of votes.keys()) if (Math.abs(b - best) > 3) second = Math.max(second, sum(b));
  return { pos: base + best * BUCKET_W, share: bv / asked, second: second / asked };
}
const located = (r) => r && r.pos != null && r.share >= 0.25 && r.second <= r.share / 2;

/** Exact edge of a page inside the typed text: the page's first (or last) 240 letters, voted in a window. */
function edge(Q, L, guess, side) {
  const part = side === 'start' ? Q.slice(0, 240) : Q.slice(-240);
  if (part.length < 60) return null;
  const lo = Math.max(0, guess - 900), Wn = L.slice(lo, guess + 900 + part.length);
  const votes = new Map(); let asked = 0;
  for (let j = 0; j + 8 <= part.length; j += 4) {
    asked++;
    let p = Wn.indexOf(part.slice(j, j + 8));
    while (p >= 0) { const s = lo + p - j; votes.set(s, (votes.get(s) || 0) + 1); p = Wn.indexOf(part.slice(j, j + 8), p + 1); }
  }
  let best = null, bv = 0;
  for (const [s, v] of votes) { const t = v + (votes.get(s - 1) || 0) + (votes.get(s + 1) || 0) + (votes.get(s - 2) || 0) + (votes.get(s + 2) || 0); if (t > bv) { bv = t; best = s; } }
  if (best == null || bv / asked < 0.2) return null;
  return side === 'start' ? best : best + part.length;
}
/** Share of the page's 8-grams (every third) present in the typed span: the overlap score. */
function overlap(Q, span) {
  if (Q.length < 40 || span.length < 40) return 0;
  const set = new Set();
  for (let i = 0; i + 8 <= span.length; i++) set.add(span.slice(i, i + 8));
  let n = 0, hit = 0;
  for (let j = 0; j + 8 <= Q.length; j += 3) { n++; if (set.has(Q.slice(j, j + 8))) hit++; }
  return n ? hit / n : 0;
}

// ── typed texts ─────────────────────────────────────────────────────────────
const manifest = new Map(readJsonl(path.join(DIR, 'manifest.jsonl')).map((m) => [m.source_id, m]));
let shardName = null, shardRows = null;
function refOf(sourceId) {
  const m = manifest.get(sourceId);
  if (shardName !== m.derived_shard) {
    shardRows = new Map(zlib.gunzipSync(fs.readFileSync(path.join(DIR, 'derived', m.derived_shard))).toString('utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.source_id, r]; }));
    shardName = m.derived_shard;
  }
  const r = shardRows.get(sourceId);
  // The stream: per typed page, fold(text) then fold(notes). `at[i]` is where page i starts.
  const at = new Int32Array(r.pages.length + 1); const parts = [];
  let off = 0;
  r.pages.forEach((p, i) => { at[i] = off; const s = foldLatin(p.text) + foldLatin(p.notes.join(' ')); parts.push(s); off += s.length; });
  at[r.pages.length] = off;
  return { L: parts.join(''), at, pages: r.pages.map((p) => ({ n: p.n, facs: p.facs, ref: p.ref })) };
}
const pageAt = (at, x) => { let lo = 0, hi = at.length - 2; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (at[mid] <= x) lo = mid; else hi = mid - 1; } return lo; };

// ── our pages ───────────────────────────────────────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const pagesCol = client.db('bookstore').collection('pages');
const prep = (p) => ({ n: p.page_number, q: foldLatin(bodyText(p.ocr?.data || '')), engine: engineOf(p.ocr) });
/** The seeded sample: 12 page numbers evenly spaced over the book, fetched alone (most candidates are rejected here). */
async function samplePages(bookId, pagesCount) {
  const want = Math.min(12, pagesCount), step = pagesCount / want, off0 = seedOf(bookId) % Math.max(1, Math.floor(step));
  const nums = [...new Set(Array.from({ length: want }, (_, i) => Math.min(pagesCount, 1 + Math.floor(i * step) + off0)))];
  const rows = await pagesCol.find({ book_id: bookId, page_number: { $in: nums } }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1 } }).hint({ book_id: 1, page_number: 1 }).toArray();
  return rows.map(prep).filter((p) => p.q.length >= 200);
}
const pageCache = new Map();
async function ourPages(bookId) {
  if (pageCache.has(bookId)) return pageCache.get(bookId);
  const rows = await pagesCol.find({ book_id: bookId }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1 } }).hint({ book_id: 1, page_number: 1 }).toArray();
  const out = rows.map(prep).filter((p) => p.q.length >= 200).sort((a, b) => a.n - b.n);
  if (pageCache.size > 3) pageCache.delete(pageCache.keys().next().value);
  pageCache.set(bookId, out);
  return out;
}
const seedOf = (s) => parseInt(createHash('sha256').update(`${SEED}|${s}`).digest('hex').slice(0, 8), 16);

// ── run ─────────────────────────────────────────────────────────────────────
const books = new Map(readJsonl(`${WORK}/books.jsonl`).map((b) => [b.id, b]));
let cands = readJsonl(path.join(DIR, 'candidates.jsonl'));
cands.sort((a, b) => (manifest.get(a.source_id).derived_shard + a.source_id).localeCompare(manifest.get(b.source_id).derived_shard + b.source_id) || a.book_id.localeCompare(b.book_id));
if (LIMIT) cands = cands.slice(0, LIMIT);
const donePairs = new Set();
const pairsFile = path.join(DIR, 'pairs.jsonl'), pagesFile = path.join(DIR, 'aligned-pages.jsonl');
if (fs.existsSync(pairsFile) && !process.argv.includes('--fresh')) for (const r of readJsonl(pairsFile)) donePairs.add(`${r.source_id}|${r.book_id}`);
else { fs.writeFileSync(pairsFile, ''); fs.writeFileSync(pagesFile, ''); }
let curRef = null, curId = null, n = 0;
for (const c of cands) {
  if (donePairs.has(`${c.source_id}|${c.book_id}`)) continue;
  if (curId !== c.source_id) { curRef = refOf(c.source_id); curId = c.source_id; }
  const ref = curRef, book = books.get(c.book_id);
  const base = { source: c.source, source_id: c.source_id, book_id: c.book_id, tier: c.tier, reason: c.reason, align_version: ALIGN_VERSION, parse_version: PARSE_VERSION };
  if (ref.L.length < 2000) { fs.appendFileSync(pairsFile, JSON.stringify({ ...base, kind: null, verdict: 'no-text', ref_letters: ref.L.length }) + '\n'); continue; }
  // 3b. the sample. Books with stored OCR on the first leaves only are sampled over those leaves.
  const span0 = (book?.pages_ocr || 0) < 0.5 * (book?.pages_count || 0) ? Math.max(book?.pages_ocr || 0, 12) : book?.pages_count || 0;
  const sample = await samplePages(c.book_id, Math.min(span0, book?.pages_count || span0));
  const hits = sample.map((p) => locate(p.q, ref.L, { grams: 24 })).filter(located);
  if (hits.length < 2) {
    fs.appendFileSync(pairsFile, JSON.stringify({ ...base, kind: null, verdict: sample.length < 2 ? 'no-text' : 'text-not-found', sampled: sample.length, located: hits.length }) + '\n');
    continue;
  }
  const ours = await ourPages(c.book_id);
  // 4. every page
  const rows = [];
  let anchor = null;                                // end of the last located page: the next page is looked for near it first
  for (const p of ours) {
    let r = anchor == null ? null : locate(p.q, ref.L, { lo: anchor - 4 * p.q.length - 2000, hi: anchor + 14 * p.q.length + 4000 });
    if (!located(r)) r = locate(p.q, ref.L);
    if (!located(r)) continue;
    anchor = r.pos + p.q.length;
    const s = edge(p.q, ref.L, r.pos, 'start'), e = edge(p.q, ref.L, r.pos + p.q.length, 'end');
    const start = Math.max(0, s ?? r.pos), end = Math.min(ref.L.length, e ?? (start + p.q.length));
    if (end - start < 100) continue;
    const i = pageAt(ref.at, start + 30), j = pageAt(ref.at, Math.max(start, end - 30));
    const tol = Math.max(80, Math.round(0.06 * (end - start)));
    const congruent = s != null && e != null && Math.abs(start - ref.at[i]) <= tol && Math.abs(end - ref.at[j + 1]) <= tol && j - i <= 1;
    rows.push({ ...base, page_number: p.n, span: [start, end], ref_page_idx: [i, j], ref_pb: [ref.pages[i]?.n ?? null, ref.pages[j]?.n ?? null], ref_facs: ref.pages[i]?.facs ?? null,
      vote_share: Math.round(r.share * 1000) / 1000, overlap: Math.round(overlap(p.q, ref.L.slice(start, end)) * 1000) / 1000, edges: s != null && e != null ? 'both' : s != null ? 'start' : e != null ? 'end' : 'none', congruent, our_letters: p.q.length, engine: p.engine });
  }
  // Order check: our page numbers and typed offsets must rise together (a wrong text that shares stock passages does not).
  let asc = 0; for (let k2 = 1; k2 < rows.length; k2++) if (rows[k2].span[0] >= rows[k2 - 1].span[0]) asc++;
  const monotone = rows.length > 1 ? asc / (rows.length - 1) : 1;
  const good = rows.filter((r) => r.overlap >= 0.5);
  const cong = good.filter((r) => r.congruent).length;
  const coverBook = good.length / ours.length;
  const covered = new Set(); for (const r of good) for (let x = r.ref_page_idx[0]; x <= r.ref_page_idx[1]; x++) covered.add(x);
  const coverRef = covered.size / Math.max(1, ref.pages.length);
  const kind = good.length < 2 || monotone < 0.8 ? null : cong / good.length >= 0.6 ? 'same-edition' : 'same-work-other-edition';
  const period = periodOf(book?.published);
  const confidence = !kind ? null : kind === 'same-edition' ? (cong / good.length >= 0.8 && good.length >= 10 ? 'high' : 'medium') : (coverBook >= 0.5 ? 'high' : coverBook >= 0.15 ? 'medium' : 'low');
  fs.appendFileSync(pairsFile, JSON.stringify({ ...base, kind, verdict: kind ? 'text-found' : 'text-found-but-inconsistent', confidence, sampled: sample.length, located: hits.length, our_pages: ours.length, aligned_pages: good.length, located_pages: rows.length,
    congruent_pages: cong, congruent_share: good.length ? Math.round((cong / good.length) * 1000) / 1000 : 0, monotone: Math.round(monotone * 1000) / 1000, cover_book: Math.round(coverBook * 1000) / 1000, cover_ref: Math.round(coverRef * 1000) / 1000,
    median_overlap: good.length ? [...good.map((r) => r.overlap)].sort((a, b) => a - b)[good.length >> 1] : null, language: book?.language || null, period, visible: !!book?.visible,
    why: kind ? `${c.reason}; ${hits.length}/${sample.length} sampled pages found; ${good.length} pages aligned (median overlap ${good.length ? [...good.map((r) => r.overlap)].sort((a, b) => a - b)[good.length >> 1] : 0}); ${cong} start and end on the typed text's page breaks` : null }) + '\n');
  if (kind) fs.appendFileSync(pagesFile, good.map((r) => JSON.stringify({ ...r, kind, language: book?.language || null, period })).join('\n') + '\n');
  if (++n % 25 === 0) console.log('pairs', n, c.source_id, '×', c.book_id, kind, good.length);
}
console.log('done', n);
await client.close();
