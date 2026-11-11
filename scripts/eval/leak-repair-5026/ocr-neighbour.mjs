#!/usr/bin/env node
// PRIOR ART: scripts/eval/context-bleed-5274/ocr-overlap.mjs — the same question (is a page's OCR its neighbour's
// text?) as a WHOLE-PAGE token share >= 0.6. It misses the two shapes the #5026 pilot failed on: a page whose OCR
// carries a column of its neighbour's text beside its own (Hebrew Bible p.494, Isaiah 63 from p.493) and a 15-character
// show-through gloss (Chinese Daodejing p.7). scripts/audit/translation-page-boundaries.mjs sharedRun is exact
// characters, and the frame already left out pairs whose OCR share an exact 200-char run; two OCR reads of the same
// passage differ in line breaks, punctuation and a letter here and there, so an exact run breaks within a line.
/**
 * ocr-neighbour — does page n's OCR hold a passage of page n-1's or n+1's OCR? (#5026, leak repair round 2)
 *
 *   node --env-file=.env.production.local scripts/eval/leak-repair-5026/ocr-neighbour.mjs --pages=FILE --out=FILE.jsonl
 *        FILE: JSON { pages: [{ book_id, page, page_id }] } or JSONL of the same.
 *
 * Text: the OCR body (editorial blocks out, tags out, combining marks out, folded long s / u-v / i-j), as tokens:
 * one Han / kana / Hangul character each, or one word of letters otherwise. A token of n is COVERED when it lies in a
 * shingle (4 words, or 4 characters) printed once on n that the neighbour's OCR also has. `run` is the longest stretch of covered tokens,
 * gaps of up to GAP uncovered tokens bridged (a variant reading inside a shared passage). A page is `ocr_dup` when that
 * run is at least RUN_WORDS words (RUN_CHARS characters for Han and kana) against either neighbour.
 * A running head or catchword is a few tokens; a sentence crossing the page break is printed once. $0, secondary reads.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

export const RUN_WORDS = 20, RUN_CHARS = 12, GAP = 3;
const STRIP = /<(meta|image-desc|detected-images|vocab|summary|keywords|warning|note|lang|language|page-type|page-num|header|sig|script|scan-quality|columns)\b[^>]*>[\s\S]*?<\/\1>/gi;
// Combining marks folded away only where they are pointing or accents (Latin, Greek, Hebrew, Arabic): a Tibetan or
// Indic vowel sign is a letter of the word, and dropping it makes unlike syllables one token.
const MARKS = /[\u0300-\u036f\u0591-\u05c7\u064b-\u065f\u0670]/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** OCR → { toks, cjk }. */
export function ocrTokens(ocr) {
  const t = String(ocr || '').replace(STRIP, ' ').replace(/<[^>]+>/g, ' ').normalize('NFD').replace(MARKS, '')
    .toLowerCase().replace(/ſ/g, 's').replace(/v/g, 'u').replace(/j/g, 'i').replace(/æ/g, 'ae').replace(/œ/g, 'oe');
  const cjkChars = t.match(new RegExp(CJK.source, 'gu')) || [];
  const words = t.replace(new RegExp(CJK.source, 'gu'), ' ').match(/\p{L}[\p{L}\p{M}]*/gu) || [];
  if (cjkChars.length >= words.length) return { toks: cjkChars, cjk: true };
  return { toks: words, cjk: false };
}

/** Longest covered run of `a` against `b` (both ocrTokens results), and the share of a's tokens covered. */
export function coveredRun(a, b) {
  const K = a.cjk ? 4 : 4;
  const A = a.toks, B = b.toks;
  if (A.length < K || B.length < K || a.cjk !== b.cjk) return { run: 0, covered: 0, share: 0, at: -1 };
  const set = new Set();
  for (let i = 0; i + K <= B.length; i++) set.add(B.slice(i, i + K).join('\u0001'));
  // a shingle printed more than once on page n itself is a formula (a refrain, a table's repeated cell, "ad m ad m"),
  // not a passage carried over: it covers nothing
  const own = new Map();
  for (let i = 0; i + K <= A.length; i++) { const s = A.slice(i, i + K).join('\u0001'); own.set(s, (own.get(s) || 0) + 1); }
  const cov = new Uint8Array(A.length);
  for (let i = 0; i + K <= A.length; i++) { const s = A.slice(i, i + K).join('\u0001'); if (own.get(s) === 1 && set.has(s)) for (let j = i; j < i + K; j++) cov[j] = 1; }
  let best = 0, bestAt = -1, cur = 0, start = -1, gap = 0, covered = 0;
  for (let i = 0; i < A.length; i++) {
    if (cov[i]) { covered++; if (cur === 0) start = i; cur += 1 + gap; gap = 0; if (cur > best) { best = cur; bestAt = start; } }
    else if (cur > 0 && gap < GAP) gap++;
    else { cur = 0; gap = 0; }
  }
  return { run: best, covered, share: +(covered / A.length).toFixed(3), at: bestAt };
}

/** Verdict for page n against its neighbours' OCR (strings or null). */
export function ocrNeighbour(ocrN, ocrPrev, ocrNext) {
  const me = ocrTokens(ocrN);
  const floor = me.cjk ? RUN_CHARS : RUN_WORDS;
  const side = (o) => (o == null ? null : coveredRun(me, ocrTokens(o)));
  const prev = side(ocrPrev), next = side(ocrNext);
  const hit = (s) => s && s.run >= floor;
  const sample = (s) => (s && s.at >= 0 ? me.toks.slice(s.at, s.at + Math.min(s.run, 40)).join(me.cjk ? '' : ' ') : '');
  return {
    n_tokens: me.toks.length, cjk: me.cjk,
    prev_run: prev?.run ?? null, prev_share: prev?.share ?? null, next_run: next?.run ?? null, next_share: next?.share ?? null,
    ocr_dup: Boolean(hit(prev) || hit(next)), side: hit(prev) && hit(next) ? 'both' : hit(prev) ? 'prev' : hit(next) ? 'next' : null,
    sample: hit(prev) || hit(next) ? sample((prev?.run ?? 0) >= (next?.run ?? 0) ? prev : next) : '',
  };
}

/** Screen pages [{book_id, page, page_id}] over Mongo `pages` (OCR of n-1, n, n+1). */
export async function screen(pagesColl, rows, { onBook } = {}) {
  const byBook = new Map();
  for (const r of rows) (byBook.get(r.book_id) ?? byBook.set(r.book_id, []).get(r.book_id)).push(r);
  const out = [];
  for (const [b, rs] of byBook) {
    const want = [...new Set(rs.flatMap((r) => [r.page - 1, r.page, r.page + 1]))];
    const m = new Map((await pagesColl.find({ book_id: b, page_number: { $in: want } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.page_number, p.ocr?.data ?? null]));
    for (const r of rs) out.push({ page_id: r.page_id, book_id: b, page: r.page, ...ocrNeighbour(m.get(r.page), m.get(r.page - 1) ?? null, m.get(r.page + 1) ?? null) });
    onBook?.();
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
  const raw = fs.readFileSync(arg('pages'), 'utf8').trim();
  const rows = raw.startsWith('{') && !raw.includes('\n{') ? JSON.parse(raw).pages : raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
  await c.connect();
  let k = 0;
  const out = await screen(c.db('bookstore').collection('pages'), rows.map((r) => ({ ...r, page: Number(r.page ?? r.page_number) })), { onBook: () => { if (++k % 500 === 0) console.error(`${k} books`); } });
  await c.close();
  fs.writeFileSync(arg('out'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  console.log(JSON.stringify({ pages: out.length, ocr_dup: out.filter((o) => o.ocr_dup).length, by_side: out.reduce((a, o) => ((a[o.side ?? 'none'] = (a[o.side ?? 'none'] || 0) + 1), a), {}) }));
}
