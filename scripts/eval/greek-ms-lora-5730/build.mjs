#!/usr/bin/env node
// PRIOR ART: scripts/eval/greek-ms-fit-5619.mjs (#5619: the fit of Schneider 1847 / Berthelot–Ruelle to the Greek
// manuscripts, measurement only, which writes letter offsets but no label text, and whose edition stream keeps the
// apparatus; its fold, stream and LOCATED / edge rules are copied here unchanged) and scripts/lib/sefaria-fit.mjs
// (locate / anchorAt / buildIndex / spanText / FIT_RULES, used unchanged). scripts/eval/latin-distill-6871/build-train.mjs
// builds a training set from stored teacher reads, not from an edition. None of them emits image + edition-span pairs.
//
// #5730 burst 2 — build the Greek-manuscript training / test sets (PREREGISTRATION.md in this directory).
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/greek-ms-lora-5730/build.mjs --out <dir>
// Reads Mongo only. Writes <dir>/{train,val,test}.jsonl and build-summary.json. Nothing is written to Mongo.
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { buildIndex, locate, anchorAt, fitEnd, spanText, FIT_RULES } from '../../lib/sefaria-fit.mjs';
import { bodyText } from '../../import/sefaria-fit-5560.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', '.');
const SEED = 5730;

// Books (#5619 full-fit-summaries.json).
const SCHNEIDER = '69942ffcbb14908bbd9a1123'; // Proclus In Tim., Schneider 1847 (our OCR of the print)
const CAAG = '6994383a6879ff0184cb803a';      // Berthelot–Ruelle, Collection des anciens alchimistes grecs 2–3 (1887)
const TRAIN_BOOK = { id: '69a5e5e385fa13e734e41894', name: 'Grec 1839', ed: SCHNEIDER };
const T1 = [{ id: '69a5e5e985fa13e734e41cba', name: 'Grec 1841', ed: SCHNEIDER }];
const T2 = [{ id: '6a45298cc6d95bc278fbc8c3', name: 'Marcianus gr. 299', ed: CAAG }, { id: '69b4c04d978ca9526eda33f7', name: 'Ars sacra (Laurenziana)', ed: CAAG }];

// ── fold (greek-ms-fit-5619.mjs, copied) ──
const VARIANT = { 'ς': 'σ', 'ϲ': 'σ', 'ϐ': 'β', 'ϑ': 'θ', 'ϕ': 'φ', 'ϖ': 'π', 'ϱ': 'ρ', 'ϰ': 'κ', 'ϒ': 'υ' };
export function foldGreekChar(c) {
  const b = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (b.length !== 1) return '';
  const v = VARIANT[b] || b;
  return /[α-ω]/.test(v) ? v : '';
}
export const greekLetters = (t) => { let o = ''; for (const c of String(t || '').normalize('NFC')) o += foldGreekChar(c); return o; };

/** An edition page's body without its apparatus: the "---" rule and every line after it, footnote calls, "|" marks. */
export function editionBody(ocr) {
  let t = bodyText(ocr);
  const cut = t.search(/^\s*-{3,}\s*$/m);
  if (cut >= 0) t = t.slice(0, cut);
  return t.replace(/\^\s*\d+\s*\)/g, '').replace(/\s\|\s/g, ' ').replace(/^>\s?/gm, '').replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2');
}

/** Label / reference text: one running line, whitespace collapsed (the manuscript's line breaks are not the edition's). */
// Edition furniture is dropped too: footnote calls (⁸) / 7)), bold marks, Berthelot–Ruelle's section numbers (8]) and
// folio cues ((f. 95 v.)), and a word hyphenated across the edition's line is joined.
export const flat = (t) => t
  .replace(/\$\^\{?\s*\d+\s*\)?\s*\}?\$\s*\)?/g, '').replace(/\(\s*Pag\.[^)]{0,20}\)/g, '')
  .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+\s*\)?/g, '').replace(/(^|[\p{L}\s.,;·])\d{1,3}\s?\)/gu, '$1').replace(/\*\*/g, '')
  .replace(/(^|\s)\d{1,3}\]/g, '$1').replace(/\(\s*f\.\s*\d+\s*[rv]?\.?\s*\)/g, '')
  .replace(/(\p{L})-\s+(\p{L})/gu, '$1$2')
  // Then only Greek and its punctuation survive (Schneider's inline B/C/D section letters, LaTeX residue, editorial brackets).
  .replace(/[^\p{Script=Greek}\p{M}\s.,;·:'’᾽᾿ʼ!?«»()\-—]/gu, '').replace(/\(\s*\)/g, '').replace(/\s+([.,;·:])/g, '$1').replace(/\s+/g, ' ').trim();

function buildStream(segments) { // greek-ms-fit-5619 buildGreekStream, plus `clean` for spanText
  const letters = [], seg = [], off = [], clean = [];
  segments.forEach((s, si) => {
    const t = String(s.text || '').normalize('NFC'); clean.push(t);
    for (let i = 0; i < t.length; i++) { const f = foldGreekChar(t[i]); if (f) { letters.push(f); seg.push(si); off.push(i); } }
  });
  return { segments, clean, letters: letters.join(''), seg: Int32Array.from(seg), off: Int32Array.from(off) };
}

const db = await (async () => { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); globalThis.__c = c; return c.db(process.env.MONGODB_DB || 'bookstore'); })();

async function edition(id) {
  const ps = await db.collection('pages').find({ book_id: id, page_number: { $gte: 0 } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  const stream = buildStream(ps.filter((p) => p.ocr?.data).map((p) => ({ ref: `${id} p${p.page_number}`, text: editionBody(p.ocr.data) })));
  return { stream, index: buildIndex(stream.letters, 7) };
}

async function pagesOf(id) {
  return (await db.collection('pages').find({ book_id: id, page_number: { $gte: 0 } },
    { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, archived_photo: 1, photo: 1, 'ocr.edited_by': 1 } }).sort({ page_number: 1 }).toArray())
    .map((p) => { const body = p.ocr?.data ? bodyText(p.ocr.data) : ''; return { id: p.id, page_number: p.page_number, src: p.archived_photo || p.photo, served_model: p.ocr?.model || null, served: p.ocr?.data || '', body, q: greekLetters(body) }; });
}

/** The #5619 fit on the page's stored read: LOCATED (monotone with neighbours) and confident edges [start, end). */
function fit(pages, ed) {
  const { stream, index } = ed;
  const text = pages.filter((p) => p.q.length >= FIT_RULES.minTextLetters);
  for (const t of text) { const r = locate(t.q, index, { slack: 64 }); t.s = r.pos; t.share = r.share; }
  text.forEach((t, k) => {
    const before = text.slice(Math.max(0, k - 3), k), after = text.slice(k + 1, k + 4);
    const lt = before.filter((u) => u.s != null && u.s < t.s).length, gt = after.filter((u) => u.s != null && u.s > t.s).length;
    t.located = t.s != null && lt >= Math.min(2, before.length) && gt >= Math.min(2, after.length);
  });
  const far = Math.floor(stream.letters.length / 2);
  const chanceOf = (q, side, pos) => {
    const piece = side === 'end' ? q.slice(-150) : q.slice(0, 150);
    const farAt = (pos + far) % Math.max(1, stream.letters.length - 800);
    const w = stream.letters.slice(farAt, farAt + 800);
    const rev = (s) => [...s].reverse().join('');
    return side === 'end' ? fitEndId(piece, w) : fitEndId(rev(piece), rev(w));
  };
  for (const t of text.filter((x) => x.located)) {
    for (const side of ['start', 'end']) {
      const a = anchorAt(t.q, index, stream, { side, lo: Math.max(0, t.s - 3000), hi: t.s + t.q.length + 3000 });
      const chance = a.pos == null ? 0 : chanceOf(t.q, side, a.pos);
      t[side] = a.pos != null && a.identity >= FIT_RULES.anchorIdentity && a.identity - chance >= FIT_RULES.anchorMargin ? a.pos : null;
    }
  }
  return text;
}
const fitEndId = (q, w) => fitEnd(q, w).identity;

/** Both edges, in order, and the span's letters within the read/span ratio band of FIT_RULES. */
function usable(t) {
  if (!t.located || t.start == null || t.end == null || t.end <= t.start) return false;
  const r = t.q.length / (t.end - t.start);
  return r >= FIT_RULES.readSpanRatio[0] && r <= FIT_RULES.readSpanRatio[1];
}

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

const summary = { at: new Date().toISOString(), rules: FIT_RULES, sets: {} };
const eds = { [SCHNEIDER]: await edition(SCHNEIDER), [CAAG]: await edition(CAAG) };
for (const [k, e] of Object.entries(eds)) summary[`edition_${k}_letters`] = e.stream.letters.length;

const row = (b, t, ed, set) => {
  const ref = flat(spanText(ed.stream, t.start, t.end));
  return { id: t.id, set, book: b.id, book_name: b.name, page_number: t.page_number, src: t.src, served_model: t.served_model, text: ref, ref_letters: greekLetters(ref).length, read_letters: t.q.length, span: [t.start, t.end] };
};

// Split by BOOK and by TEXT: Grec 1841 covers nearly every passage Grec 1839 does (excluding its whole range left 0
// training pages), so Schneider's letter stream is cut at CUT. Grec 1839 trains on pages wholly before the cut, Grec 1841
// is tested on pages wholly after it, with MARGIN letters of air on each side. T2 is another edition entirely.
const CUT = Number(arg('cut', '0.7')), MARGIN = 3000;
const cutAt = Math.floor(eds[SCHNEIDER].stream.letters.length * CUT);
summary.cut = { fraction: CUT, letter: cutAt, margin: MARGIN };
const test = [];
for (const [set, books] of [['T1', T1], ['T2', T2]]) {
  for (const b of books) {
    const ed = eds[b.ed]; const pages = await pagesOf(b.id); const fitted = fit(pages, ed);
    const use = fitted.filter(usable).filter((t) => set !== 'T1' || t.start > cutAt + MARGIN);
    for (const t of use) test.push({ ...row(b, t, ed, set), served_body: bodyText(pages.find((p) => p.id === t.id).served) });
    summary.sets[`${set} ${b.name}`] = { pages: pages.length, text: fitted.length, located: fitted.filter((x) => x.located).length, usable: fitted.filter(usable).length, test: use.length };
  }
}
const isBlocked = (a, z) => z > cutAt - MARGIN;

const tp = await pagesOf(TRAIN_BOOK.id); const tf = fit(tp, eds[SCHNEIDER]);
const tu = tf.filter(usable);
const keep = tu.filter((t) => !isBlocked(t.start, t.end));
const r = rng(SEED); const shuffled = keep.map((t) => [r(), t]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
const nVal = Math.max(30, Math.round(shuffled.length * 0.05));
const val = shuffled.slice(0, nVal).map((t) => row(TRAIN_BOOK, t, eds[SCHNEIDER], 'val'));
const train = shuffled.slice(nVal).map((t) => row(TRAIN_BOOK, t, eds[SCHNEIDER], 'train'));
summary.sets[`train ${TRAIN_BOOK.name}`] = { pages: tp.length, text: tf.length, located: tf.filter((x) => x.located).length, usable: tu.length, after_cut: tu.length - keep.length, train: train.length, val: val.length };
summary.label_chars = { train_median: med(train.map((x) => x.text.length)), train_max: Math.max(...train.map((x) => x.text.length)) };
summary.test = Object.fromEntries(['T1', 'T2'].map((s) => [s, test.filter((x) => x.set === s).length]));

function med(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
fs.mkdirSync(OUT, { recursive: true });
const w = (f, rows) => fs.writeFileSync(path.join(OUT, f), rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
w('train.jsonl', train); w('val.jsonl', val); w('test.jsonl', test);
fs.writeFileSync(path.join(OUT, 'build-summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary.sets), JSON.stringify(summary.test), JSON.stringify(summary.label_chars));
await globalThis.__c.close();
