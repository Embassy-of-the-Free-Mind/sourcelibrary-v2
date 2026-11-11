#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-page-boundary.mjs (#3918) — its boundarySignals (dup / carried / ocrNext /
// anchors), attributeLane and laneIndex are imported unchanged; it scores a PAGE against both neighbours and draws
// with `$sample`, where this scores the JOIN (N, N+1) from a seeded draw over the exact frame (break-frame.mjs).
// scripts/lib/block-drift.mjs (continuationFragment, sourceProse, translationProse) and scripts/lib/page-integrity.mjs
// (parseCatchword, dominantScript) are reused for the source-side tests. New here: the English-side join state
// (ends open / opens as a continuation), the doubled word at the join, and the edge-paragraph length ratio.
/**
 * census — deterministic seam signals on ONE random translated break per live book (#6742). $0, Mongo reads only.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/seams-6742/census.mjs \
 *        --frame=DIR/frame.jsonl.gz --out=DIR [--n=2000] [--seed=6742]
 *
 * Books are shuffled by a seeded RNG (makeRng); the first n with ≥1 break each contribute one break drawn
 * uniformly from their breaks. Writes census.jsonl (one row per break, signals + the four edge texts) and
 * census-summary.json (rates with Wilson CIs per stratum; break-weighted rates with a book bootstrap and the
 * extrapolation to the frame's exact break count).
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { MongoClient } from 'mongodb';
import { boundarySignals, attributeLane, words, longestWordRun, sourcesRepeat } from '../../audit/translation-page-boundary.mjs';
import { continuationFragment, sourceProse, translationProse } from '../../lib/block-drift.mjs';
import { parseCatchword, dominantScript, NON_PROSE_TYPES } from '../../lib/page-integrity.mjs';
import { wilson } from '../lib/agreement-stats.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;

// ── join-state helpers ───────────────────────────────────────────────────────
// Closing punctuation in the scripts the corpus holds: Latin/Greek/Cyrillic . ! ? … ; Han 。！？; Devanagari । ॥;
// Tibetan ། ༎; Arabic ؟ ۔; Hebrew ׃; Armenian ։. A trailing quote or bracket may follow.
const SRC_TERMINAL = /[.!?…。！？।॥།༎؟۔׃։:](?:\s*[»”"'’)\]）」』]+)?$/u;
const EN_TERMINAL = /[.!?:»”"'’)\]]$/u;
const EN_ELLIPSIS_TAIL = /(?:…|\.\s*\.\s*\.)\s*[»”"'’)\]]*$|[-–—]$/u;
const EN_CONT_HEAD = /^\s*[«“"'‘(\[]*\s*(?:…|\.\s*\.\s*\.|[-–—])/u;
// Furniture: no 3-letter word; or a short line (≤ 60 chars, ≤ 7 words) that is mostly capitals or carries a numeral —
// a running head ("524 C. PLINII SECVNDI", "No. 6366.] CHAPTER XLIX.", "Page 63").
export const isFurniture = (l) => {
  const t = l.trim();
  if (!t || !/\p{L}{3,}/u.test(t)) return true;
  if (t.length > 60 || t.split(/\s+/).length > 7) return false;
  const L = (t.match(/\p{L}/gu) || []).length, U = (t.match(/\p{Lu}/gu) || []).length;
  return (L && U / L >= 0.6) || /\p{N}/u.test(t);
};
/** English with the renderer's centring marks (->, <-, a leading "- ") and heading marks removed. */
const cleanEn = (t) => String(t).replace(/->|<-/g, ' ').replace(/^[ \t]*[-#]+[ \t]+/gm, '').replace(/[ \t]+/g, ' ');
export function bodyLines(text) {
  const ls = String(text).split('\n');
  let a = 0, b = ls.length;
  while (a < b && a < 6 && isFurniture(ls[a])) a++;
  while (b > a && ls.length - b < 6 && isFurniture(ls[b - 1])) b--;
  return ls.slice(a, b);
}
/** Source prose with the catchword line removed (a lone last-line word that the next page opens with). */
export function sourceTail(ocrA, ocrB) {
  const ls = bodyLines(sourceProse(ocrA));
  const last = (ls[ls.length - 1] || '').trim();
  const headB = words(sourceProse(ocrB)).slice(0, 3);
  const lw = words(last);
  if (lw.length && lw.length <= 2 && ls.length > 1 && headB[0] && lw[0] === headB[0]) ls.pop();
  return ls.join('\n').trim();
}
const lastWordsEn = (t, n) => words(t).slice(-n);
const firstWordsEn = (t, n) => words(t).slice(0, n);
export const STOP = new Set(['the', 'and', 'of', 'to', 'a', 'in', 'that', 'is', 'it', 'for', 'as', 'with', 'he', 'his', 'this', 'be', 'by', 'on', 'which', 'or', 'not', 'are', 'was', 'i']);

/** Paragraphs of a raw OCR / translation (blank-line separated) after housekeeping is stripped. */
function paragraphs(raw, prose) {
  const stripped = prose(String(raw || '').replace(/\n[ \t]*\n/g, '\n\u0007PARA\u0007\n'));
  return stripped.split('\u0007PARA\u0007').map(s => s.trim()).filter(s => (s.match(/[\p{L}\p{N}]/gu) || []).length >= 20);
}
const letters = (t) => (String(t).match(/[\p{L}\p{N}]/gu) || []).length;

/** Every join signal for the break A → B. A0 = page before A, B1 = page after B (either may be null). */
export function joinSignals({ A0, A, B, B1 }) {
  const enA = cleanEn(translationProse(A.tr)), enB = cleanEn(translationProse(B.tr));
  const srcA = sourceTail(A.ocr, B.ocr), srcBraw = sourceProse(B.ocr);
  const script = dominantScript(srcA + ' ' + srcBraw);
  const cased = ['latin', 'greek', 'cyrillic', 'armenian'].includes(script);
  const s = { script, wordsA: words(enA).length, wordsB: words(enB).length };
  if (s.wordsA < 20 || s.wordsB < 20) return { ...s, skipped: 'short' };
  // Only cased scripts make an end-of-page claim: classical Chinese/Korean and many Indic sources carry no closing
  // punctuation at all, so a missing full stop there says nothing (seen on the 60-break pilot).
  const linesA = bodyLines(srcA);
  const lastSrc = (linesA[linesA.length - 1] || '').trim().replace(/[*_`~\s]+$/u, '');
  // A word split by a hyphen whose completion closes the sentence ("cit-" | "tadini?") is a closed break: the
  // completion is left to continuationFragment, which needs ≥ 20 letters of carried clause.
  const hyphenSplit = /[-‐‑⸗=¬]$/u.test(lastSrc);
  const srcEndOpen = !cased || !lastSrc ? null : hyphenSplit ? null : !SRC_TERMINAL.test(lastSrc);
  const frag = cased ? continuationFragment(B.ocr) : null;
  s.srcEndOpen = srcEndOpen;
  s.srcNextCont = !!frag;
  // The source runs across the break: a cased next page opening on a lowercase clause, or (any script) page N's
  // body ending without closing punctuation.
  s.srcContinues = s.srcNextCont || srcEndOpen === true;
  // The English carries the page's furniture too (running head "524 C. PLINII SECVNDI", "EPISTLE LXXXVIII."): read
  // the join from the first and last BODY lines.
  const enTailA = bodyLines(enA).join('\n').trim().replace(/[*_`~\s]+$/u, '') || enA.trim();
  const enHeadB = bodyLines(enB).join('\n').trim().replace(/^[*_`~\s]+/u, '') || enB.trim();
  s.enEndOpen = EN_ELLIPSIS_TAIL.test(enTailA) || !EN_TERMINAL.test(enTailA);
  const firstLetter = enHeadB.match(/\p{L}/u)?.[0];
  s.enNextCont = EN_CONT_HEAD.test(enHeadB) || (!!firstLetter && firstLetter === firstLetter.toLowerCase() && firstLetter !== firstLetter.toUpperCase());
  // 1. English leaves a sentence hanging on N and N+1 restarts with a capital: the join does not read across.
  s.enHangsThenFreshAny = s.enEndOpen && !s.enNextCont;
  s.enHangsThenFresh = s.enHangsThenFreshAny && s.srcContinues;   // only where the source is known to run on
  // 1b. A bracketed bridge: N+1's English opens with an editorial "[…]" of words, or N's closes with one — the
  // translator supplying the other page's words (T6 fabricated bridge).
  s.bracketBridge = /^\s*\[[^\]]{3,80}\]/u.test(enHeadB) || /\[[^\]]{0,80}\]\s*$/u.test(enTailA) || /\[\s*(?:…|\.\.\.)\s*\]/u.test(enHeadB.slice(0, 40) + enTailA.slice(-40));
  // 2. English joins as a continuation but the source closes at the break (a carried clause where none is).
  s.enContSrcClosed = !s.enEndOpen && s.enNextCont && !s.srcContinues;
  // 3. Omission / closure tell: the source continues, the English ends clean or starts fresh.
  s.omissionTell = s.srcContinues && (!s.enEndOpen || !s.enNextCont);
  s.closedOverOpen = s.srcContinues && !s.enEndOpen && !s.enNextCont;   // both sides closed (the strong form)
  // 4. Duplicated n-gram at the facing edges (≥5 words within the last/first 80), refused when the sources repeat.
  const tw = lastWordsEn(enTailA, 80), hw = firstWordsEn(enHeadB, 80);
  const run = longestWordRun(tw, hw, 5);
  s.dupJoin = run.len >= 5 && !sourcesRepeat(A.ocr, B.ocr);
  if (s.dupJoin) s.dupJoinText = run.text;
  // 5. A word doubled across the join (catchword rendered on both pages): last 1–2 words of N = first of N+1.
  const l2 = lastWordsEn(enTailA, 2), f2 = firstWordsEn(enHeadB, 2);
  const echo1 = l2.length && f2.length && l2[l2.length - 1] === f2[0] && !STOP.has(f2[0]) && f2[0].length >= 3;
  const echo2 = l2.length === 2 && f2.length === 2 && l2.join(' ') === f2.join(' ');
  s.catchwordEcho = !!(echo1 || echo2);
  const cw = parseCatchword(A.ocr);
  s.catchwordInSource = !!cw?.judged;
  // 6. Edge-paragraph length: last paragraph of N and first of N+1, English/source letters, against the page's own
  // ratio — only where the page's paragraph counts agree (≥2), so the paragraphs plausibly align.
  const edge = (pg, which) => {
    const ps = paragraphs(pg.ocr, sourceProse), pt = paragraphs(pg.tr, translationProse);
    if (ps.length < 2 || ps.length !== pt.length) return null;
    const page = letters(pt.join(' ')) / Math.max(1, letters(ps.join(' ')));
    const k = which === 'last' ? ps.length - 1 : 0;
    const r = letters(pt[k]) / Math.max(1, letters(ps[k]));
    return page > 0 ? +(r / page).toFixed(3) : null;
  };
  s.edgeRelA = edge(A, 'last');
  s.edgeRelB = edge(B, 'first');
  s.edgeLow = [s.edgeRelA, s.edgeRelB].some(x => x != null && x < 0.5);
  s.edgeHigh = [s.edgeRelA, s.edgeRelB].some(x => x != null && x > 2.0);
  // 7. #3918's page signals, scored from A's side (next = B) and B's side (prev = A).
  const bA = boundarySignals({ page: A, prev: A0, next: B });
  const bB = boundarySignals({ page: B, prev: A, next: B1 });
  s.dup8 = !!(bA.dupNext || bB.dupPrev);
  s.carried = !!bA.carried;
  s.ocrNext = !!bA.ocrNext;
  s.anchorsMoved = !!(bA.anchorsNext || bB.anchorsPrev);
  s.nonProse = NON_PROSE_TYPES.has(A.type) || NON_PROSE_TYPES.has(B.type);
  s.strong = s.bracketBridge || s.dupJoin || s.dup8 || s.carried || s.ocrNext || s.closedOverOpen || s.enHangsThenFresh || s.catchwordEcho || s.edgeLow || s.edgeHigh;
  s.any = s.strong || s.omissionTell || s.enContSrcClosed || s.anchorsMoved;
  return s;
}
export const SIGNALS = ['any', 'strong', 'omissionTell', 'closedOverOpen', 'enHangsThenFresh', 'enHangsThenFreshAny', 'bracketBridge', 'nonProse', 'enContSrcClosed', 'dupJoin', 'dup8',
  'catchwordEcho', 'edgeLow', 'edgeHigh', 'carried', 'ocrNext', 'anchorsMoved', 'srcContinues'];

// ── Mongo ────────────────────────────────────────────────────────────────────
const PROJ = { _id: 0, id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1,
  'translation.updated_at': 1, 'translation.prompt_version': 1, 'translation.source': 1, 'translation.engine.call_site': 1 };
const asPage = (r) => r && ({ id: r.id, p: r.page_number, type: r.page_type, ocr: r.ocr?.data || '', tr: typeof r.translation?.data === 'string' ? r.translation.data : '',
  model: r.translation?.model || null, at: r.translation?.updated_at || null, pv: r.translation?.prompt_version || null, src: r.translation?.source || null,
  callSite: r.translation?.engine?.call_site || null });

async function laneIndex(db) {
  const chained = new Set(), batchRoute = new Map();
  for await (const r of db.collection('translate_batch_runs').find({ mode: 'chained', shadow: { $ne: true } }, { projection: { queue: 1, blocks: 1 } }).batchSize(1000)) {
    for (const q of r.queue || []) chained.add(q.id);
    for (const b of r.blocks || []) for (const p of b.pages || []) chained.add(p.id);
  }
  for await (const j of db.collection('batch_jobs').find({ type: 'translation' }, { projection: { page_ids: 1, created_at: 1 } }).batchSize(1000)) {
    for (const id of j.page_ids || []) batchRoute.set(id, j.created_at);
  }
  return { chained, batchRoute };
}

const EDGE = 1500;
const tail = (t) => t.length > EDGE ? '…' + t.slice(-EDGE) : t;
const head = (t) => t.length > EDGE ? t.slice(0, EDGE) + '…' : t;
const modelFamily = (m) => !m ? 'unknown' : /flash-lite/.test(m) ? 'flash-lite' : /flash/.test(m) ? 'flash' : /pro/.test(m) ? 'gemini-pro' : /claude|opus|sonnet/.test(m) ? 'claude' : m.split(/[-/]/).slice(0, 2).join('-');

async function main() {
  const out = arg('out'), framePath = arg('frame');
  const n = Number(arg('n', 2000)), seed = Number(arg('seed', 6742));
  fs.mkdirSync(out, { recursive: true });
  const frame = zlib.gunzipSync(fs.readFileSync(framePath)).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
  const totalBreaks = frame.reduce((a, b) => a + b.breaks, 0);
  const rand = makeRng(seed);
  const order = frame.filter(b => b.breaks > 0);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const idx = await laneIndex(db);
  const file = path.join(out, 'census.jsonl');
  const prior = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const seen = new Set(prior.map(r => r.book));
  const rows = [...prior];
  const w = fs.createWriteStream(file, { flags: 'a' });
  let k = 0, skipped = 0;
  for (const b of order) {
    if (rows.filter(r => !r.skipped).length >= n) break;
    if (seen.has(b.id)) continue;
    const have = new Set(b.pages.map(x => x[0]));
    const starts = b.pages.map(x => x[0]).filter(p => have.has(p + 1));
    const pick = starts[Math.floor(rand() * starts.length)];
    const got = await db.collection('pages').find({ book_id: b.id, page_number: { $in: [pick - 1, pick, pick + 1, pick + 2] } }, { projection: PROJ }).toArray();
    const by = new Map(got.map(r => [r.page_number, asPage(r)]));
    const A = by.get(pick), B = by.get(pick + 1);
    if (!A?.tr || !B?.tr) { skipped++; continue; }
    const sig = joinSignals({ A0: by.get(pick - 1)?.tr ? by.get(pick - 1) : null, A, B, B1: by.get(pick + 2)?.tr ? by.get(pick + 2) : null });
    const row = { book: b.id, p: pick, lang: b.lang || 'unknown', olang: b.olang, breaksInBook: b.breaks, typeA: A.type || null, typeB: B.type || null,
      lane: attributeLane(A, idx), laneB: attributeLane(B, idx), model: A.model, modelB: B.model, family: modelFamily(A.model), pv: A.pv, at: A.at,
      idA: A.id, idB: B.id, url: `https://sourcelibrary.org/book/${b.id}/page/${B.id}`, ...sig,
      srcTailA: tail(sourceProse(A.ocr)), srcHeadB: head(sourceProse(B.ocr)), enTailA: tail(translationProse(A.tr)), enHeadB: head(translationProse(B.tr)) };
    seen.add(b.id); rows.push(row); w.write(JSON.stringify(row) + '\n');
    if (++k % 200 === 0) process.stderr.write(`${rows.length} drawn\n`);
  }
  await new Promise(r => w.end(r));
  await client.close();
  const summary = summarise(rows.filter(r => !r.skipped), totalBreaks, rows.filter(r => r.skipped).length, seed);
  fs.writeFileSync(path.join(out, 'census-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  console.log(JSON.stringify(summary.overall, null, 0).slice(0, 3000));
}

const rate = (k, n) => { const [lo, hi] = wilson(k, n); return { k, n, rate: n ? +(k / n).toFixed(4) : null, lo: +lo.toFixed(4), hi: +hi.toFixed(4) }; };
/** Break-weighted rate (each book stands for its breaks) with a 95% percentile bootstrap over books. */
function weighted(rows, sigKey, iters = 2000) {
  const est = (rs) => { let w = 0, f = 0; for (const r of rs) { w += r.breaksInBook; if (r[sigKey]) f += r.breaksInBook; } return w ? f / w : 0; };
  const rnd = makeRng(1);
  const bs = [];
  for (let i = 0; i < iters; i++) { const rs = []; for (let j = 0; j < rows.length; j++) rs.push(rows[Math.floor(rnd() * rows.length)]); bs.push(est(rs)); }
  bs.sort((a, b) => a - b);
  return { rate: +est(rows).toFixed(4), lo: +bs[Math.floor(iters * 0.025)].toFixed(4), hi: +bs[Math.floor(iters * 0.975)].toFixed(4) };
}
export function summarise(rows, totalBreaks, skippedShort, seed) {
  const overall = { seed, books: rows.length, skippedShort, frameBreaks: totalBreaks, perBook: {}, breakWeighted: {}, extrapolatedBreaks: {} };
  for (const s of SIGNALS) {
    overall.perBook[s] = rate(rows.filter(r => r[s]).length, rows.length);
    const wv = weighted(rows, s);
    overall.breakWeighted[s] = wv;
    overall.extrapolatedBreaks[s] = { est: Math.round(wv.rate * totalBreaks), lo: Math.round(wv.lo * totalBreaks), hi: Math.round(wv.hi * totalBreaks) };
  }
  const strat = (fn) => {
    const g = {};
    for (const r of rows) (g[fn(r)] ||= []).push(r);
    return Object.fromEntries(Object.entries(g).sort((a, b) => b[1].length - a[1].length)
      .map(([k, xs]) => [k, Object.fromEntries(['any', 'strong', 'omissionTell', 'closedOverOpen', 'enHangsThenFresh', 'dupJoin', 'catchwordEcho', 'edgeLow'].map(s => [s, rate(xs.filter(x => x[s]).length, xs.length)]))]));
  };
  return { overall, byLane: strat(r => r.lane), byFamily: strat(r => r.family), byScript: strat(r => r.script || 'none'),
    byLang: strat(r => r.lang), bySrcContinues: strat(r => r.srcContinues ? 'source-continues' : 'source-closed') };
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
