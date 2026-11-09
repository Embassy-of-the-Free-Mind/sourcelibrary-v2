#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/wrong-leaf-fix-5021.mjs --issue=5026 and scripts/eval/leak-repair-5026/pair-judge.mjs —
// the proper repair (re-translate the wrong page from its own leaf, agy) and its spot checks; they need a model call per
// page and reach the 16,589 flagged pairs only over days. scripts/maintenance/strip-proquest-stamp.mjs — the shape of a
// deterministic text edit through writePageText (prior object, only data + content_hash changed, one run id per run).
// scripts/lib/neighbour-guard.mjs neighbourVerdict — the #8401 rule for WHICH page carries the neighbour's text, used
// as-is. None of them removes a duplicated passage without a model, which is what this does.
/**
 * STATUS 2026-11-08: REJECTED at the spot check (8/30 right against 29/30; scripts/eval/experiments/
 * 2026-11-08-leak-strip-5026.md). Nothing was written; `apply` has never run with --apply. Kept for the measurement
 * and so a later variant starts from it, not from scratch.
 *
 * leak-strip-5026 — containment for #5026: remove the passage of English a page shares with its neighbour from the
 * page that does not own it, so no reader sees the same passage on two neighbouring pages. Deterministic: no model
 * writes page text; the remaining English is the stored reading, unchanged. The proper own-leaf re-translation stays
 * with the waves (job leak-repair2-5026); every page this strips is listed for them.
 *
 *   node --env-file=… scripts/maintenance/leak-strip-5026.mjs plan  --in=/tmp/leak-joined-500.jsonl --out=DIR
 *   … spot-draw --out=DIR | spot-judge --out=DIR | spot-score --out=DIR       (blind Opus, before any write)
 *   … apply --out=DIR --wave=N [--books=N|--from=i --to=j] [--apply]          (writePageText, run id leak-strip-5026-wN)
 *   … redetect --out=DIR                                                       (the detector on the touched books, live)
 *   … post-draw | post-judge | post-score --out=DIR
 *   … record --out=DIR --round=spot|post [--apply]                             (book_checks, method leak-strip-5026)
 *
 * The plan, per flagged pair (re-read live):
 *  - skipped: missing page, human edit, withheld, Tibetan/Pali book, no longer flagged (run < 200 on the live English:
 *    the waves re-translated it, or something else did), the SOURCES share a run (a refrain), the shared English is
 *    printed on the page (a facing or bilingual edition; English books: printed on both), the two leaves are one text.
 *  - wrong page: neighbourVerdict (scripts/lib/neighbour-guard.mjs) asked from each side; the page it refuses is the
 *    wrong one. Neither or both refused → 'undecided', left to the waves.
 *  - edit: the shared run, widened to whole words and, while the next sentence fragment still matches the
 *    neighbour's English (token share >= 0.6), to that fragment's sentence end; repeated while a run >= 200 remains
 *    (max 4). Refused when the stripped English is under 20% of exp(K) x source length ('too-short'), when the cut
 *    would take a markup tag with it ('markup-in-cut'), or when the removed passage is no longer on the neighbour
 *    after every edit in the book ('chain': the passage would vanish from both pages).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { neighbourVerdict, leakNorm, LEAK_MIN_CHARS } from '../lib/neighbour-guard.mjs';
import { lengthRatioK } from '../lib/block-page-guard.mjs';

const MODE = process.argv[2];
const arg = (n, d = null) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const has = (n) => process.argv.includes(`--${n}`);
const OUT = path.resolve(arg('out', '.'));
fs.mkdirSync(OUT, { recursive: true });
const readJsonl = (f) => {
  if (!fs.existsSync(f)) return [];
  const raw = f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') : fs.readFileSync(f, 'utf8');
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
export const RUN_PREFIX = 'leak-strip-5026';
const REFRAIN_LANG = /tibet|pali/i;

let client, db;
async function open() {
  client = new MongoClient(process.env.MONGODB_URI, { readPreference: arg('read', 'primary') });
  await client.connect(); db = client.db('bookstore');
}

// ── text ──
const EDITORIAL = /<(meta|summary|keywords|vocab|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi;
/**
 * leakNorm with an offset map: norm[i] came from raw[map[i]]. Built by masking what leakNorm deletes (editorial
 * blocks, centre markers, tags) and folding whitespace. Returns null when it does not reproduce leakNorm exactly.
 */
export function normWithMap(raw) {
  raw = String(raw || '');
  const mask = new Uint8Array(raw.length);
  const cover = (re) => { for (const m of raw.matchAll(re)) mask.fill(1, m.index, m.index + m[0].length); };
  cover(EDITORIAL);
  // centre markers before tags, as stripMarkupTags does; then tags in the text that remains
  for (const m of raw.matchAll(/->|<-/g)) if (!mask[m.index]) mask.fill(1, m.index, m.index + 2);
  let vis = ''; const vmap = [];
  for (let i = 0; i < raw.length; i++) { if (mask[i]) { vis += ' '; } else vis += raw[i]; vmap.push(i); }
  for (const m of vis.matchAll(/<[^>]+>/g)) mask.fill(1, m.index, m.index + m[0].length);
  let norm = ''; const map = []; let space = false;
  for (let i = 0; i < raw.length; i++) {
    const ws = mask[i] || /\s/.test(raw[i]);
    if (ws) { if (norm.length) space = true; continue; }
    if (space) { norm += ' '; map.push(i - 1); space = false; }
    norm += raw[i]; map.push(i);
  }
  if (norm !== leakNorm(raw)) return null;
  return { norm, map, mask };
}

/** sharedRun (neighbour-guard) with positions: the longest run a and b share, { len, a, b } (starts). */
export function sharedRunAt(a, b, min = LEAK_MIN_CHARS) {
  if (a.length < min || b.length < min) return { len: 0, a: -1, b: -1 };
  const K = 40, idx = new Map();
  for (let i = 0; i + K <= b.length; i += 8) { const s = b.slice(i, i + K); if (!idx.has(s)) idx.set(s, i); }
  let best = 0, bestA = -1, bestB = -1;
  for (let i = 0; i + K <= a.length; i++) {
    const j = idx.get(a.slice(i, i + K)); if (j == null) continue;
    let back = 0; while (i - back > 0 && j - back > 0 && a[i - back - 1] === b[j - back - 1]) back++;
    let L = K; while (i + L < a.length && j + L < b.length && a[i + L] === b[j + L]) L++;
    if (L + back > best) { best = L + back; bestA = i - back; bestB = j - back; }
    i += Math.max(0, L - K);
  }
  return { len: best, a: bestA, b: bestB };
}

const toks = (s) => String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
/** Share of a's tokens (>= 3 of them) found in b. */
const tokIn = (a, b) => { const A = toks(a); if (A.length < 3) return 0; const B = new Set(toks(b)); return A.filter((x) => B.has(x)).length / A.length; };
const isWord = (c) => c != null && /[\p{L}\p{N}'’]/u.test(c);
const SENT_END = /[.!?;:»"”)\]]/;

/**
 * The cut [s, e) in W's normalised text for one run at (s0, len) in W and (o0) in O: whole words, then sentence
 * fragments at either edge that still match O's English around the same place.
 */
export function widenCut(W, O, s0, o0, len) {
  let s = s0, e = s0 + len, os = o0, oe = o0 + len;
  while (s > 0 && isWord(W[s - 1]) && isWord(W[s])) s--;
  while (e < W.length && isWord(W[e - 1]) && isWord(W[e])) e++;
  for (let k = 0; k < 3 && e < W.length; k++) { // forward: up to the next sentence end
    let j = e; while (j < W.length && j - e < 300 && !(SENT_END.test(W[j]) && (j + 1 >= W.length || W[j + 1] === ' '))) j++;
    if (j >= W.length || j - e >= 300) j = Math.min(W.length - 1, j);
    const frag = W.slice(e, j + 1), ofrag = O.slice(oe, oe + frag.length + 60);
    if (tokIn(frag, ofrag) < 0.6) break;
    oe += frag.length; e = j + 1;
  }
  for (let k = 0; k < 3 && s > 0; k++) { // backward: back to the previous sentence end
    let j = s - 1; while (j > 0 && s - j < 300 && !(SENT_END.test(W[j - 1]) && W[j] === ' ')) j--;
    const frag = W.slice(j, s), ofrag = O.slice(Math.max(0, os - frag.length - 60), os);
    if (tokIn(frag, ofrag) < 0.6) break;
    os -= frag.length; s = j;
  }
  // nothing but space and punctuation left on the far side of a page edge: take it too
  if (!/[\p{L}\p{N}]/u.test(W.slice(0, s))) s = 0;
  if (!/[\p{L}\p{N}]/u.test(W.slice(e))) e = W.length;
  return { s, e };
}

/**
 * May this span be cut out whole? Every tag in it closes inside it (a <note>…</note> of the copied passage goes with
 * it), the centring markers pair up, and it holds no page-level editorial block (meta, summary, keywords, vocab).
 */
export function balancedMarkup(s) {
  if (/<\/?(meta|summary|keywords|vocab|image-desc|page-type|detected-images)\b/i.test(s)) return false;
  if ((s.match(/->/g) || []).length !== (s.match(/<-/g) || []).length) return false;
  const stack = [];
  for (const m of s.replace(/->|<-/g, ' ').matchAll(/<(\/?)([a-z][\w-]*)[^>]*?(\/?)>/gi)) {
    if (m[3]) continue; // self-closing
    if (!m[1]) stack.push(m[2].toLowerCase());
    else if (stack.pop() !== m[2].toLowerCase()) return false;
  }
  return stack.length === 0 && !/<(?![a-z/])/i.test(s.replace(/->|<-/g, ''));
}

const PAGE_LEVEL = /^(meta|summary|keywords|vocab|image-desc|page-type|detected-images)$/i;
/**
 * Widen [rs, re) so it holds whole elements: a <note>/<term>/<margin>… it cuts through is taken whole (it is part of
 * the copied passage), and a centred line `->…<-` it cuts through is taken whole. A page-level block (meta, summary…)
 * it touches → [-1, -1]: refuse.
 */
export function snapToElements(raw, rs, re) {
  const els = []; const stack = [];
  for (const m of raw.replace(/->|<-/g, '  ').matchAll(/<(\/?)([a-z][\w-]*)[^>]*?(\/?)>/gi)) {
    if (m[3]) continue;
    const name = m[2].toLowerCase();
    if (!m[1]) stack.push({ name, at: m.index });
    else { const i = stack.map((x) => x.name).lastIndexOf(name); if (i < 0) continue; const o = stack.splice(i)[0]; els.push({ name, s: o.at, e: m.index + m[0].length }); }
  }
  for (const m of raw.matchAll(/->[^\n]*?<-/g)) els.push({ name: 'centre', s: m.index, e: m.index + m[0].length });
  for (let changed = true, guard = 0; changed && guard < 20; guard++) {
    changed = false;
    for (const el of els) {
      const overlaps = el.s < re && el.e > rs, inside = el.s >= rs && el.e <= re, holds = el.s <= rs && el.e >= re;
      if (!overlaps || inside) continue;
      if (PAGE_LEVEL.test(el.name)) return [-1, -1];
      if (holds && el.name !== 'centre' && el.e - el.s > 3 * (re - rs)) return [-1, -1]; // the cut sits inside one big element
      rs = Math.min(rs, el.s); re = Math.max(re, el.e); changed = true;
    }
  }
  return [rs, re];
}

/** Remove raw[rs, re) and join the two sides with the larger break. */
function cutRaw(raw, rs, re) {
  const before = raw.slice(0, rs).replace(/[ \t]+$/, ''), after = raw.slice(re).replace(/^[ \t]+/, '');
  const nl = /\n\s*$/.test(before) || /^\s*\n/.test(after) || !before.trim() || !after.trim();
  const b = before.replace(/\s+$/, ''), a = after.replace(/^\s+/, '');
  return (b && a ? b + (nl ? '\n\n' : ' ') + a : b + a).replace(/\n{3,}/g, '\n\n');
}

/**
 * Strip from W's raw English every run >= LEAK_MIN_CHARS shared with O's English. Returns { text, removed: [string],
 * reason? } — reason set when the edit is refused.
 */
export function stripShared(rawW, rawO) {
  let raw = String(rawW);
  const nO = leakNorm(rawO);
  const removed = [], cores = [];
  for (let pass = 0; pass < 4; pass++) {
    const m = normWithMap(raw);
    if (!m) return { reason: 'norm-mismatch' };
    const run = sharedRunAt(m.norm, nO);
    // after the first cut, a further run must be a passage, not a repeated gloss of a word both pages print
    if (run.len < (pass ? 2 * LEAK_MIN_CHARS : LEAK_MIN_CHARS)) return { text: raw, removed, cores };
    let { s, e } = widenCut(m.norm, nO, run.a, run.b, run.len);
    // a folded space maps to the raw char before the next visible one (it can be a tag's '>'): cut on visible chars
    while (s < e && m.norm[s] === ' ') s++;
    while (e > s && m.norm[e - 1] === ' ') e--;
    let rs = m.map[s], re = m.map[e - 1] + 1;
    if (s === 0) rs = 0; if (e === m.norm.length) re = raw.length;
    const cut = raw.slice(rs, re);
    // a page edge cut may take leading/trailing editorial blocks or tags; keep them by cutting only the visible span
    if (s === 0 || e === m.norm.length) {
      rs = s === 0 ? m.map[0] : rs; re = e === m.norm.length ? m.map[m.norm.length - 1] + 1 : re;
    }
    [rs, re] = snapToElements(raw, rs, re);
    if (rs < 0) return { reason: 'markup-in-cut', cut: raw.slice(m.map[s], m.map[e - 1] + 1).slice(0, 300) };
    const inner = raw.slice(rs, re);
    if (!balancedMarkup(inner)) return { reason: 'markup-in-cut', cut: inner.slice(0, 300) };
    removed.push(m.norm.slice(s, e)); cores.push(m.norm.slice(run.a, run.a + run.len));
    raw = cutRaw(raw, rs, re);
    void cut;
  }
  return { reason: 'runs-remain' };
}

const strip = (s) => String(s || '').replace(/<detected-images>[\s\S]*?<\/detected-images>/gi, ' ');
const flat = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Share of the run's word 4-grams printed in this OCR (pair-judge printedShare, one page). */
export function printedIn(run, ocr) {
  const w = flat(run).split(' '); if (w.length < 8) return 0;
  const o = ` ${flat(ocr)} `; let k = 0, n = 0;
  for (let i = 0; i + 4 <= w.length; i += 2) { n++; if (o.includes(` ${w.slice(i, i + 4).join(' ')} `)) k++; }
  return n ? k / n : 0;
}
const tokSet = (s) => new Set(String(s || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
const ocrShare = (a, b) => { const A = tokSet(a), B = tokSet(b); if (A.size < 12) return null; let k = 0; for (const x of A) if (B.has(x)) k++; return k / A.size; };
const humanEdited = (t) => !!(t && (t.source === 'manual' || t.edited_by || t.edited_at));
const textOf = (t) => (typeof t === 'string' ? t : typeof t?.data === 'string' ? t.data : '');

// ── plan ──
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, translation: 1, translation_withheld: 1 };

/** Decide and build the edits of one book's flagged pairs. Pure over the loaded pages. */
export function planBook({ book, pairs, pages, k }) {
  const rows = [];
  const live = new Map(pages.map((p) => [p.page_number, p]));
  const edits = new Map(); // page_number → { page, text, removed: [], from: [] }
  const lang = String(book?.language || '');
  for (const r of pairs) {
    const base = { book: r.book, prev: r.prev, next: r.next, lang: r.lang, stratum: r.site?.startsWith('scripts/batch/cli-translate') ? 'cur' : /^english$/i.test(r.lang) ? 'en' : r.month < '2026-07' ? 'pre07' : r.month < '2026-10' ? 'mid' : 'late' };
    const A = live.get(r.prev), B = live.get(r.next);
    const skip = (reason, extra = {}) => rows.push({ ...base, state: 'skip', reason, ...extra });
    if (!A || !B) { skip('missing'); continue; }
    if (REFRAIN_LANG.test(lang) || REFRAIN_LANG.test(r.lang || '')) { skip('tibetan-pali'); continue; }
    if (humanEdited(A.translation) || humanEdited(B.translation)) { skip('human-edit'); continue; }
    if (A.translation_withheld || B.translation_withheld) { skip('withheld'); continue; }
    if (r.prev <= 0) { skip('soft-hidden'); continue; }
    const enA = textOf(A.translation), enB = textOf(B.translation);
    const nA = leakNorm(enA), nB = leakNorm(enB);
    const run = sharedRunAt(nB, nA);
    if (run.len < LEAK_MIN_CHARS) { skip('no-longer-flagged', { live_len: run.len }); continue; }
    const srcA = strip(A.ocr?.data), srcB = strip(B.ocr?.data);
    const srcRun = sharedRunAt(leakNorm(srcB), leakNorm(srcA), Math.min(LEAK_MIN_CHARS, Math.max(40, Math.floor(Math.min(srcA.length, srcB.length) / 2))));
    if (srcRun.len >= Math.min(LEAK_MIN_CHARS, Math.max(40, Math.floor(Math.min(srcA.length, srcB.length) / 2)))) { skip('sources-share'); continue; }
    const os_ = ocrShare(srcB, srcA);
    if (os_ != null && os_ >= 0.5) { skip('one-text-ocr', { ocr_share: +os_.toFixed(2) }); continue; }
    const runText = nB.slice(run.a, run.a + run.len);
    const pA = printedIn(runText, srcA), pB = printedIn(runText, srcB);
    const english = /^english$/i.test(lang) || /^english$/i.test(r.lang || '');
    if (english ? pA >= 0.3 && pB >= 0.3 : pA >= 0.3 || pB >= 0.3) { skip('printed', { printed_a: +pA.toFixed(2), printed_b: +pB.toFixed(2) }); continue; }
    // the #8401 rule, asked from each side
    const vA = neighbourVerdict({ page: { src: A.ocr?.data ?? '', en: enA, type: A.page_type }, next: { src: B.ocr?.data ?? '', en: enB }, k });
    const vB = neighbourVerdict({ page: { src: B.ocr?.data ?? '', en: enB, type: B.page_type }, prev: { src: A.ocr?.data ?? '', en: enA }, k });
    const leakA = vA.refuse && vA.reason === 'neighbour-leak', leakB = vB.refuse && vB.reason === 'neighbour-leak';
    if (leakA === leakB) { skip(leakA ? 'undecided-both' : k == null ? 'undecided-no-k' : 'undecided', { k }); continue; }
    const W = leakA ? A : B, O = leakA ? B : A;
    // English books: the passage must not be printed on the page it is taken from
    if (english && printedIn(runText, strip(W.ocr?.data)) >= 0.3) { skip('printed-on-wrong-page'); continue; }
    const cur = edits.get(W.page_number);
    const fromText = cur ? cur.text : textOf(W.translation);
    const res = stripShared(fromText, textOf(O.translation));
    if (res.reason) { skip(res.reason, { wrong: W.page_number, ...(res.cut ? { cut: res.cut } : {}) }); continue; }
    const expected = k == null ? null : Math.exp(k) * String(W.ocr?.data || '').length;
    if (expected != null && res.text.length < 0.2 * expected) { skip('too-short', { wrong: W.page_number, left: res.text.length, expected: Math.round(expected) }); continue; }
    if (k == null && leakNorm(res.text).length < 200) { skip('too-short', { wrong: W.page_number, left: res.text.length, expected: null }); continue; }
    const e = cur || { page: W, text: '', removed: [], cores: [], from: [], pairs: [] };
    e.text = res.text; e.removed.push(...res.removed); e.cores.push(...res.cores); e.from.push(O.page_number); e.pairs.push(`${r.prev}-${r.next}`);
    edits.set(W.page_number, e);
    rows.push({ ...base, state: 'edit', wrong: W.page_number, other: O.page_number, dir: leakA ? 'N' : 'N+1', run: run.len, removed_chars: res.removed.reduce((s, x) => s + x.length, 0) });
  }
  // chain check: every removed passage must still be on the page it was taken from, after all of the book's edits
  const finalText = (n) => (edits.has(n) ? edits.get(n).text : textOf(live.get(n)?.translation));
  const out = [];
  for (const [n, e] of edits) {
    // the core runs (not the widened cut, whose edges were matched loosely) must survive on a source page
    const bad = e.cores.some((x) => !e.from.some((f) => sharedRunAt(x, leakNorm(finalText(f)), Math.min(200, Math.floor(x.length * 0.8))).len >= 0.8 * x.length));
    if (bad) { for (const r of rows) if (r.state === 'edit' && r.wrong === n) { r.state = 'skip'; r.reason = 'chain'; } continue; }
    out.push({ book: book?.id ?? e.page.book_id, page_id: e.page.id, page: n, from: e.from, pairs: e.pairs, prior_len: textOf(e.page.translation).length, next_len: e.text.length,
      prior_hash: e.page.translation?.content_hash ?? null, prior: textOf(e.page.translation), next: e.text, removed: e.removed });
  }
  return { rows, edits: out };
}

async function plan() {
  await open();
  const pairs = readJsonl(arg('in', '/tmp/leak-joined-500.jsonl'));
  const byBook = new Map(); for (const r of pairs) { const a = byBook.get(r.book) || []; a.push(r); byBook.set(r.book, a); }
  const ids = [...byBook.keys()];
  const limit = Number(arg('limit', 0)); if (limit) ids.length = Math.min(ids.length, limit);
  const books = new Map((await db.collection('books').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, title: 1, language: 1, human_read_count: 1, visible: 1 } }).toArray()).map((b) => [b.id, b]));
  const rowsOut = zlib.createGzip(), editsOut = zlib.createGzip();
  rowsOut.pipe(fs.createWriteStream(path.join(OUT, 'plan-rows.jsonl.gz'))); editsOut.pipe(fs.createWriteStream(path.join(OUT, 'plan-edits.jsonl.gz')));
  const tally = {}; let nb = 0, ne = 0;
  const queue = [...ids];
  const worker = async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      const rs = byBook.get(b);
      const nums = [...new Set(rs.flatMap((r) => [r.prev, r.next]))];
      const pages = await db.collection('pages').find({ book_id: b, page_number: { $in: nums } }, { projection: PROJ }).toArray();
      const lens = await db.collection('pages').aggregate([
        { $match: { book_id: b, 'translation.data': { $type: 'string' }, 'ocr.data': { $type: 'string' } } },
        { $project: { _id: 0, type: '$page_type', src: { $strLenCP: '$ocr.data' }, en: { $strLenCP: '$translation.data' } } }]).toArray();
      const k = lengthRatioK(lens);
      const { rows, edits } = planBook({ book: books.get(b) || { id: b }, pairs: rs, pages, k });
      for (const r of rows) { const key = r.state === 'edit' ? 'edit' : `skip:${r.reason}`; tally[key] = (tally[key] || 0) + 1; rowsOut.write(JSON.stringify({ ...r, reads: books.get(b)?.human_read_count || 0, visible: !!books.get(b)?.visible }) + '\n'); }
      for (const e of edits) { editsOut.write(JSON.stringify({ ...e, title: books.get(b)?.title, language: books.get(b)?.language, reads: books.get(b)?.human_read_count || 0, visible: !!books.get(b)?.visible, k }) + '\n'); ne++; }
      if (++nb % 500 === 0) console.log(`  ${nb}/${ids.length} books, ${ne} edits`, JSON.stringify(tally));
    }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', 6)) }, worker));
  await Promise.all([new Promise((r) => { rowsOut.on('end', r); rowsOut.end(); }), new Promise((r) => { editsOut.on('end', r); editsOut.end(); })]);
  const summary = { at: new Date().toISOString(), books: ids.length, pairs: pairs.length, pages_to_edit: ne, by_state: tally };
  fs.writeFileSync(path.join(OUT, 'plan-summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}

// ── spot check (before any write) and post-check (after) ──
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffle = (xs, rnd) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const STRATUM = (e) => (/^english$/i.test(e.language || '') ? 'en' : 'other');

/**
 * 30 planned edits, one per book (seeded; books with readers first in a 2:1 mix, languages spread, English books in
 * their share), and 2 controls: a planned edit INVERTED, i.e. the shared passage cut from the page the rule says owns
 * it. The judge is not told which is which.
 */
async function spotDraw() {
  const edits = readJsonl(arg('plan-edits', path.join(OUT, 'plan-edits.jsonl.gz')));
  const rnd = mulberry32(Number(arg('seed', 50264)));
  const N = Number(arg('n', 30));
  const pool = shuffle(edits.filter((e) => e.from.length === 1), rnd);
  const used = new Set(), langs = new Map(), picked = [];
  const cap = Math.max(3, Math.ceil(N * 0.25));
  for (const e of [...pool.filter((x) => x.reads > 0 && x.visible), ...pool]) {
    if (picked.length >= N) break;
    if (used.has(e.book) || (langs.get(e.language) || 0) >= cap) continue;
    used.add(e.book); langs.set(e.language, (langs.get(e.language) || 0) + 1); picked.push({ ...e, control: null });
  }
  await open();
  const controls = [];
  for (const e of pool) {
    if (controls.length >= 2) break;
    if (used.has(e.book)) continue;
    const pages = await db.collection('pages').find({ book_id: e.book, page_number: { $in: [e.page, e.from[0]] } }, { projection: PROJ }).toArray();
    const W = pages.find((p) => p.page_number === e.page), O = pages.find((p) => p.page_number === e.from[0]);
    if (!W || !O) continue;
    const res = stripShared(textOf(O.translation), textOf(W.translation));
    if (res.reason || !res.removed.length || res.text.length < 0.4 * textOf(O.translation).length) continue;
    used.add(e.book);
    controls.push({ book: e.book, page_id: O.id, page: O.page_number, from: [W.page_number], next: res.text, removed: res.removed, prior: textOf(O.translation), title: e.title, language: e.language, control: 'inverted' });
  }
  const all = shuffle([...picked, ...controls], rnd).map((r, i) => ({ ...r, key: `S${String(i + 1).padStart(2, '0')}` }));
  fs.writeFileSync(path.join(OUT, 'spot-sample.json'), JSON.stringify(all, null, 1));
  console.log(`${all.length} edits (${controls.length} controls) in ${used.size} books`, Object.fromEntries([...langs].sort((a, b) => b[1] - a[1])));
}

export function spotPrompt({ title, language, edited, win }) {
  const L = [`You are checking a proposed edit to the English translation of "${title}" (language: ${language}). Two consecutive pages are given: for each, its scan (open the images with the Read tool when the transcription is unclear or you are in doubt), a machine transcription of the printed page (it can be wrong; trust the image), and the English readers are shown now.`, ''];
  for (const w of win) L.push(`=== Page ${w.n} ===`, w.img ? `Image file: ${w.img}` : 'Image: (not available)', `Transcription of page ${w.n}:`, '<<<', w.ocr || '(empty)', '>>>', `English shown on page ${w.n} now:`, '<<<', w.en || '(none)', '>>>', '');
  const E = win.find((w) => w.n === edited.n);
  L.push(`=== Proposed edit: page ${edited.n} ===`, `The proposal removes the following passage(s) from page ${edited.n}'s English (the other page is left as it is):`);
  edited.removed.forEach((x, i) => L.push(`Removed passage ${i + 1}:`, '<<<', x, '>>>'));
  L.push(`Page ${edited.n}'s English after the edit:`, '<<<', edited.after, '>>>', '');
  void E;
  const other = win.find((w) => w.n !== edited.n).n;
  L.push('Questions:',
    `1. own_after: after the edit, does page ${edited.n}'s English render only text printed on page ${edited.n}? "yes", or "no" (it still carries text printed on page ${other}, or on neither page).`,
    `2. other_ok: does page ${other}'s English (unchanged) render only text printed on page ${other}? "yes" or "no".`,
    `3. removed_own: did the edit remove text that renders page ${edited.n}'s own printed text? "none", "minor" (a few words or a partial clause at the edge of the cut), or "major" (a sentence or more of page ${edited.n}'s own text).`,
    `4. removed_where: where is the removed passage printed? "${other}" (only on page ${other}), "${edited.n}" (on page ${edited.n}), "both", or "neither".`,
    `5. right: is this edit right — afterwards each page carries only its own text, and nothing (beyond a few words at the edge) that belonged to page ${edited.n} was removed? "yes" or "no".`,
    'Judge content, not style. Answer with JSON only, no code fence: {"own_after":"yes|no","other_ok":"yes|no","removed_own":"none|minor|major","removed_where":"…","right":"yes|no","why":"one or two lines, citing a phrase and the page it is printed on"}');
  return L.join('\n');
}

let leafTools;
async function tools() {
  if (!leafTools) {
    const a = await import('../audit/leaf-shift-confirm-5021.mjs');
    const b = await import('../lib/page-image-url.mjs');
    leafTools = { fetchLeaf: a.fetchLeaf, claudeCall: a.claudeCall, getPageSource: b.getPageSource };
  }
  return leafTools;
}
const IMG_PROJ = { ...PROJ, cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, display_photo: 1, photo_original: 1 };

async function judgeSet({ sampleFile, resFile, post }) {
  await open();
  const { fetchLeaf, claudeCall, getPageSource } = await tools();
  const sample = JSON.parse(fs.readFileSync(path.join(OUT, sampleFile), 'utf8'));
  const RES = path.join(OUT, resFile);
  const done = new Set(readJsonl(RES).filter((r) => r.verdict).map((r) => r.key));
  const items = sample.filter((s) => !done.has(s.key));
  console.log(`${items.length} to judge (${done.size} done)`);
  const worker = async () => {
    for (let s = items.shift(); s; s = items.shift()) {
      const dir = path.join(OUT, post ? 'post' : 'spot', s.key);
      fs.mkdirSync(dir, { recursive: true });
      const nums = [s.page, s.from[0]].sort((a, b) => a - b);
      const pages = await db.collection('pages').find({ book_id: s.book, page_number: { $in: nums } }, { projection: IMG_PROJ }).sort({ page_number: 1 }).toArray();
      const win = [];
      for (const p of pages) {
        const img = `p${p.page_number}.jpg`;
        const got = await fetchLeaf({ display_photo: getPageSource(p), photo: p.photo, archived_photo: p.archived_photo, photo_original: p.photo_original }, path.join(dir, img));
        // the spot check shows the English as it was planned from (the edit is then shown beside it); the post-check the live English
        const en = !post && p.page_number === s.page ? s.prior : textOf(p.translation);
        win.push({ n: p.page_number, img: got ? img : null, ocr: strip(p.ocr?.data).slice(0, 8000), en: String(en || '').slice(0, 16000) });
      }
      if (win.length !== 2) { fs.appendFileSync(RES, JSON.stringify({ ...s, prior: undefined, next: undefined, cls: 'missing_page' }) + '\n'); continue; }
      const book = await db.collection('books').findOne({ id: s.book }, { projection: { title: 1, language: 1 } });
      const prompt = post ? postPrompt({ title: book?.title, language: book?.language, n: s.page, win, planted: s.planted })
        : spotPrompt({ title: book?.title, language: book?.language, edited: { n: s.page, removed: s.removed, after: String(s.next).slice(0, 16000) }, win });
      fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
      const res = await claudeCall(prompt, dir);
      let v = null;
      try { const a = res.text.indexOf('{'), b = res.text.lastIndexOf('}'); v = JSON.parse(res.text.slice(a, b + 1)); } catch { /* unparsed */ }
      fs.appendFileSync(RES, JSON.stringify({ key: s.key, book: s.book, page: s.page, page_id: s.page_id, from: s.from, language: s.language, control: s.control ?? null, planted: s.planted ?? null, verdict: v, cls: res.cls || (v ? null : 'unparsed'), model: res.model, usage: res.usage, secs: res.secs, ...(v ? {} : { raw: String(res.text).slice(0, 600), err: res.err }) }) + '\n');
      console.log(`  ${s.key} ${s.control || ''} ${s.language}: ${v ? JSON.stringify(v).slice(0, 160) : res.cls}`);
      if (res.cls === 'usage_limit') { items.length = 0; console.log('usage limit: stopping; re-run to resume'); }
    }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', 3)) }, worker));
}

const spotJudge = () => judgeSet({ sampleFile: 'spot-sample.json', resFile: 'spot-verdicts.jsonl', post: false });
function spotScore() {
  const last = new Map(); for (const r of readJsonl(path.join(OUT, 'spot-verdicts.jsonl'))) last.set(r.key, r);
  const rs = [...last.values()];
  const ok = (r) => r.verdict?.right === 'yes' && r.verdict?.removed_own !== 'major';
  const real = rs.filter((r) => !r.control && r.verdict), ctl = rs.filter((r) => r.control && r.verdict);
  const out = { judged: real.length, right: real.filter(ok).length, wrong: real.filter((r) => !ok(r)).map((r) => ({ key: r.key, book: r.book, page: r.page, language: r.language, v: r.verdict })),
    controls: ctl.map((r) => ({ key: r.key, caught: !ok(r), v: r.verdict })), unjudged: rs.filter((r) => !r.verdict).map((r) => ({ key: r.key, cls: r.cls })) };
  out.pass = out.judged >= 30 && out.right >= out.judged - 1 && out.controls.length === 2 && out.controls.every((c) => c.caught);
  fs.writeFileSync(path.join(OUT, 'spot-score.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

// ── apply: one writePageText edit per page, run id per wave ──
/** The order the waves take: books with readers first, then by book, page. */
const priority = (a, b) => (b.reads || 0) - (a.reads || 0) || (b.visible ? 1 : 0) - (a.visible ? 1 : 0) || String(a.book).localeCompare(String(b.book)) || a.page - b.page;
export const REASON = 'leak-strip-5026: deterministic edit, not a model read — removed the passage this page\'s English shares with its neighbour (the neighbour owns it, by the #8401 neighbourGate rule); the rest of the English is the stored reading unchanged. Needs own-leaf re-translation (#5026 waves).';

async function apply() {
  const APPLY = has('apply');
  const wave = arg('wave'); if (!wave) throw new Error('--wave=N is required');
  const RUN_ID = `${RUN_PREFIX}-w${wave}`;
  const edits = readJsonl(arg('plan-edits', path.join(OUT, 'plan-edits.jsonl.gz'))).sort(priority);
  const from = Number(arg('from', 0)), to = Number(arg('to', edits.length));
  const slice = edits.slice(from, to);
  await open();
  const { writePageText, textHash } = await import('../lib/page-text-writer.mjs');
  const { contentHash } = await import('../lib/write-provenance.mjs');
  const { recordSweepActions } = await import('../lib/sweep-log.mjs');
  const ledgerFile = path.join(OUT, `ledger-w${wave}.jsonl`);
  const tally = {}; const written = [];
  const bump = (k) => { tally[k] = (tally[k] || 0) + 1; };
  if (APPLY) {
    const byBook = new Map(); for (const e of slice) { const a = byBook.get(e.book) || []; a.push(e.page); byBook.set(e.book, a); }
    await recordSweepActions(db, [...byBook].map(([book_id, pages]) => ({ sweep: RUN_ID, book_id, action: 'strip-neighbour-duplicate', detail: { pages, issue: 5026, run_id: RUN_ID } })));
  }
  const queue = [...slice];
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const p = await db.collection('pages').findOne({ id: e.page_id }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, translation: 1, translation_withheld: 1 } });
      let status;
      if (!p) status = 'not_found';
      else if (textOf(p.translation) !== e.prior) status = 'changed_since_plan';
      else if (humanEdited(p.translation)) status = 'refused_human_edit';
      else if (p.translation_withheld) status = 'withheld';
      else if (!APPLY) status = 'dry_run';
      else {
        const prior = typeof p.translation === 'string' ? { data: p.translation } : p.translation;
        const r = await writePageText(db, p.id, 'translation', { ...prior, data: e.next, content_hash: contentHash(e.next) }, {
          by: 'scripts/maintenance/leak-strip-5026.mjs', reason: REASON, run_id: RUN_ID, revision_source: RUN_PREFIX, expect_prior_hash: textHash(p.translation) });
        status = r.status;
      }
      bump(status);
      if (status === 'written') written.push(e.page_id);
      fs.appendFileSync(ledgerFile, JSON.stringify({ run_id: RUN_ID, book: e.book, page_id: e.page_id, page: e.page, from: e.from, status, removed_chars: e.removed.reduce((s, x) => s + x.length, 0), prior_len: e.prior_len, next_len: e.next_len, language: e.language, at: new Date().toISOString() }) + '\n');
    }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', 4)) }, worker));
  // the search text mirror (page_translations); the pages-content mirror follows updated_at on its 5-minute cron
  if (APPLY && written.length && process.env.SUPABASE_DB_URL && !has('no-mirror')) {
    const { pageEmbeddingInput } = await import('../lib/page-embedding-text.mjs');
    const { default: pg } = await import('pg');
    const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    let upd = 0, absent = 0;
    try {
      for (let i = 0; i < written.length; i += 500) {
        const ps = await db.collection('pages').find({ id: { $in: written.slice(i, i + 500) } }, { projection: { _id: 0, id: 1, book_id: 1, 'translation.data': 1 } }).toArray();
        for (const p of ps) {
          const input = pageEmbeddingInput(p); if (!input?.hasTranslation) continue;
          const r = await c.query('UPDATE page_translations SET translation = $1 WHERE page_id = $2', [input.text.slice(0, 50000), p.id]);
          if (r.rowCount) upd += r.rowCount; else absent++;
        }
      }
    } finally { await c.end(); }
    tally.mirror = { page_translations_updated: upd, absent };
  }
  const out = { run_id: RUN_ID, apply: APPLY, from, to, pages: slice.length, tally };
  fs.appendFileSync(path.join(OUT, 'waves.jsonl'), JSON.stringify({ ...out, at: new Date().toISOString() }) + '\n');
  console.log(JSON.stringify(out, null, 1));
}

// ── redetect: the detector's LEAK test (translation-page-boundaries.mjs) on the live English of the given books ──
async function redetect() {
  const { sharedRun } = await import('../audit/translation-page-boundaries.mjs');
  const normTr = (t) => String(t || '').replace(/<(meta|summary|keywords|vocab|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  await open();
  const books = arg('books-file') ? JSON.parse(fs.readFileSync(arg('books-file'), 'utf8'))
    : [...new Set(readJsonl(arg('plan-edits', path.join(OUT, 'plan-edits.jsonl.gz'))).map((e) => e.book))];
  const tag = arg('tag', 'after');
  const flagsOut = fs.createWriteStream(path.join(OUT, `redetect-${tag}.jsonl`));
  const tot = { books: books.length, pairs: 0, leak200: 0, leak500: 0, sourceRepeat: 0 };
  const queue = [...books]; let k = 0;
  const worker = async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      const tr = (await db.collection('pages').find({ book_id: b, 'translation.data': { $type: 'string', $ne: '' } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).sort({ page_number: 1 }).toArray())
        .map((p) => ({ p: p.page_number, ocr: p.ocr?.data, tr: p.translation.data })).filter((r) => r.tr.trim());
      for (let i = 0; i + 1 < tr.length; i++) {
        const A = tr[i], B = tr[i + 1];
        if (B.p !== A.p + 1) continue;
        tot.pairs++;
        const leak = sharedRun(normTr(B.tr), normTr(A.tr));
        if (leak.len < LEAK_MIN_CHARS) continue;
        if (sharedRun(normTr(B.ocr), normTr(A.ocr)).len >= LEAK_MIN_CHARS) { tot.sourceRepeat++; continue; }
        tot.leak200++; if (leak.len >= 500) tot.leak500++;
        flagsOut.write(JSON.stringify({ book: b, prev: A.p, next: B.p, len: leak.len }) + '\n');
      }
      if (++k % 500 === 0) console.log(`  ${k}/${books.length}`, JSON.stringify(tot));
    }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', 6)) }, worker));
  await new Promise((r) => flagsOut.end(r));
  fs.writeFileSync(path.join(OUT, `redetect-${tag}.summary.json`), JSON.stringify({ ...tot, at: new Date().toISOString() }, null, 1));
  console.log(JSON.stringify(tot, null, 1));
}

/** Post-check: one stripped page per book (seeded, languages spread), and 2 planted controls: a stripped page with the
 * removed passage put back at the edge it came from, which the judge must call a duplicate. */
async function postDraw() {
  const led = []; for (const f of fs.readdirSync(OUT).filter((x) => /^ledger-w\d+\.jsonl$/.test(x))) led.push(...readJsonl(path.join(OUT, f)));
  const ok = new Map(led.filter((r) => r.status === 'written').map((r) => [r.page_id, r]));
  const edits = new Map(readJsonl(path.join(OUT, 'plan-edits.jsonl.gz')).filter((e) => ok.has(e.page_id) && e.from.length === 1).map((e) => [e.page_id, e]));
  const spotBooks = new Set(JSON.parse(fs.readFileSync(path.join(OUT, 'spot-sample.json'), 'utf8')).map((s) => s.book));
  const rnd = mulberry32(Number(arg('seed', 50265)));
  const pool = shuffle([...edits.values()].filter((e) => !spotBooks.has(e.book)), rnd);
  const N = Number(arg('n', 30)), cap = Math.max(3, Math.ceil(N * 0.25));
  const used = new Set(), langs = new Map(), picked = [];
  for (const e of pool) {
    if (picked.length >= N) break;
    if (used.has(e.book) || (langs.get(e.language) || 0) >= cap) continue;
    used.add(e.book); langs.set(e.language, (langs.get(e.language) || 0) + 1); picked.push({ ...e, prior: undefined, next: undefined });
  }
  const controls = pool.filter((e) => !used.has(e.book)).slice(0, 2).map((e) => { used.add(e.book); return { ...e, prior: undefined, next: undefined, planted: e.removed[0] }; });
  const all = shuffle([...picked, ...controls], rnd).map((r, i) => ({ ...r, key: `Q${String(i + 1).padStart(2, '0')}` }));
  fs.writeFileSync(path.join(OUT, 'post-sample.json'), JSON.stringify(all, null, 1));
  console.log(`${all.length} pages (${controls.length} planted)`, Object.fromEntries([...langs].sort((a, b) => b[1] - a[1])));
}

export function postPrompt({ title, language, n, win, planted }) {
  const Q = win.find((w) => w.n === n), P = win.find((w) => w.n !== n);
  // a planted control: the removed passage back at the edge it was cut from (before the page's English if the
  // neighbour is the previous page, after it if the next)
  if (planted) Q.en = P.n < n ? `${planted}\n\n${Q.en}` : `${Q.en}\n\n${planted}`;
  const where = P.n < n ? 'previous' : 'next';
  const L = [`You are checking the English translation readers are shown for page ${n} of "${title}" (language: ${language}), against the page itself. The ${where} page, ${P.n}, is given too. Open BOTH images with the Read tool; the transcriptions are machine readings that can be wrong (trust the images).`, ''];
  for (const w of [P, Q]) L.push(`=== Page ${w.n}${w === Q ? ' (the page being checked)' : ` (the ${where} page, for reference)`} ===`, w.img ? `Image file: ${w.img}` : 'Image: (not available)', `Transcription of page ${w.n}:`, '<<<', w.ocr || '(empty)', '>>>', `English shown on page ${w.n}:`, '<<<', w.en || '(none)', '>>>', '');
  L.push(`Questions, about the English of page ${n}:`,
    `1. dup: does it contain a passage of a paragraph or more that renders text printed on page ${P.n} and not on page ${n} (so a reader sees it on both pages)? "yes" or "no".`,
    `2. leaf: whose printed text does its body render? "own" (page ${n} only), "neighbour", "mixed", or "other".`,
    `3. missing: is a sentence or more of page ${n}'s own printed text missing from its English, at its start or its end in particular? "none", "minor" (a few words or a clause at an edge), or "major". Name it.`,
    `4. clean_edges: does the English begin and end cleanly (no dangling half-sentence fragment that renders nothing on page ${n})? "yes" or "no".`,
    'Judge content, not style; the English may be a partial account (other defects are out of scope here). Answer with JSON only, no code fence: {"dup":"yes|no","leaf":"own|neighbour|mixed|other","missing":"none|minor|major","clean_edges":"yes|no","why":"one or two lines citing a phrase"}');
  return L.join('\n');
}
const postJudge = () => judgeSet({ sampleFile: 'post-sample.json', resFile: 'post-verdicts.jsonl', post: true });
function postScore() {
  const last = new Map(); for (const r of readJsonl(path.join(OUT, 'post-verdicts.jsonl'))) last.set(r.key, r);
  const rs = [...last.values()];
  const real = rs.filter((r) => !r.planted && r.verdict), ctl = rs.filter((r) => r.planted && r.verdict);
  const good = (r) => r.verdict.dup === 'no' && r.verdict.missing !== 'major' && ['own', 'other'].includes(r.verdict.leaf);
  const out = { judged: real.length, dup_gone: real.filter((r) => r.verdict.dup === 'no').length, own_leaf: real.filter((r) => r.verdict.leaf === 'own').length,
    no_major_missing: real.filter((r) => r.verdict.missing !== 'major').length, clean_edges: real.filter((r) => r.verdict.clean_edges === 'yes').length, good: real.filter(good).length,
    failures: real.filter((r) => !good(r) || r.verdict.clean_edges !== 'yes').map((r) => ({ key: r.key, book: r.book, page: r.page, page_id: r.page_id, language: r.language, v: r.verdict })),
    controls: ctl.map((r) => ({ key: r.key, caught: r.verdict.dup === 'yes', v: r.verdict })), unjudged: rs.filter((r) => !r.verdict).map((r) => ({ key: r.key, cls: r.cls })) };
  fs.writeFileSync(path.join(OUT, 'post-score.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

// ── record: judged pages into book_checks (#8069), method leak-strip-5026; controls are not recorded ──
async function record() {
  await open();
  const { recordPageVerdicts, readMethod } = await import('../lib/book-checks.mjs');
  const post = arg('round', 'spot') === 'post';
  const file = path.join(OUT, post ? 'post-verdicts.jsonl' : 'spot-verdicts.jsonl');
  const last = new Map(); for (const r of readJsonl(file)) last.set(r.key, r);
  const rs = [...last.values()].filter((r) => r.verdict && !r.control && !r.planted);
  const verdicts = rs.map((r) => {
    const v = r.verdict;
    // spot: the page judged is the planned edit's page, its stored English (the edit was not yet written): serious when
    // the stored English carries the neighbour's passage (the judge says the removed passage is printed only there)
    if (!post) {
      const carry = String(v.removed_where) === String(r.from[0]);
      return { page_id: r.page_id, outcome: carry ? 'serious' : 'clean', page_verdict: carry ? 'fix' : 'show', verdict: `stored English ${carry ? 'repeats' : 'does not repeat'} page ${r.from[0]}'s text; proposed strip ${v.right === 'yes' ? 'right' : 'wrong'}`,
        note: String(v.why || '').slice(0, 500), errors: carry ? [{ stage: 'translation', kind: 'carry_over', problem: `English repeats a passage printed on page ${r.from[0]}: ${String(v.why || '').slice(0, 300)}` }] : [], defects: [] };
    }
    const errors = [...(v.dup === 'yes' ? [{ stage: 'translation', kind: 'carry_over', problem: `still carries page ${r.from[0]}'s text: ${String(v.why || '').slice(0, 300)}` }] : []),
      ...(v.missing === 'major' ? [{ stage: 'translation', problem: `omitted: ${String(v.why || '').slice(0, 300)}` }] : [])];
    const minor = v.missing === 'minor' || v.clean_edges === 'no';
    return { page_id: r.page_id, outcome: errors.length ? 'serious' : minor ? 'minor' : 'clean', page_verdict: errors.length ? 'fix' : minor ? 'caveat' : 'show', verdict: `after strip: duplicate ${v.dup}, leaf ${v.leaf}, missing ${v.missing}, clean edges ${v.clean_edges}`,
      note: String(v.why || '').slice(0, 500), errors, defects: minor ? [{ severity: 'cosmetic', what: `edge: missing ${v.missing}, clean edges ${v.clean_edges}` }] : [] };
  });
  const res = await recordPageVerdicts(db, { method_id: 'leak-strip-5026', method_version: readMethod('leak-strip-5026').version, run_id: `leak-strip-5026-${post ? 'post' : 'spot'}`, checked_at: new Date(),
    selection: 'random', stages: ['translation'], reader: { kind: 'model', model: 'claude -p --model opus', image_opened: true },
    evidence_path: `box:${os.hostname()}:${file}`, reader_warning: false, exposure: 'live',
    note: post ? 'One stripped page per book (seeded), judged blind against its image and the neighbour its duplicate came from.' : 'One planned strip per book (seeded), judged blind before writing: both pages, both Englishes, the proposed cut.',
    frame: { round: post ? 'post' : 'spot', pages: rs.length }, verdicts }, { apply: has('apply') });
  console.log(`book_checks: ${res.inserted} inserted, ${res.already} already, ${res.rows.length} rows, ${res.failed.length} failed`, res.failed.slice(0, 5));
}

const MODES = { plan, 'spot-draw': spotDraw, 'spot-judge': spotJudge, 'spot-score': spotScore, apply, redetect, 'post-draw': postDraw, 'post-judge': postJudge, 'post-score': postScore, record };
export { MODES, open, readJsonl, OUT, arg, has };
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (MODES[MODE]) await MODES[MODE]();
    else { console.error(`usage: leak-strip-5026.mjs ${Object.keys(MODES).join('|')} --out=DIR`); process.exitCode = 2; }
  } finally { await client?.close(); }
}
