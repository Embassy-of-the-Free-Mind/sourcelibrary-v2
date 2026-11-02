#!/usr/bin/env node
// PRIOR ART: run.mjs / meaning.mjs here (#7263: the 60 print pages, their typed references, #7866's judge on our read
// and on the typed text; this file adds an "archive" arm to that harness). en-ocr-reference-5124.mjs (#5124: English
// IA pages with a Wikisource / Gutenberg reference, the Archive leaf located on it and leaf-checked by eye; its djvu
// leaf parse `leafTexts` is restated below because that file runs its CLI on import). numbers-5224 (Archive number
// misreads; its token-level number scoring is the model for `numbers` below, scored here against the typed reference).
// Searched scripts/eval/INDEX.md for "three-way", "Archive vs human", "ia-djvu": no study judges the Archive's text,
// ours and a typed edition on the same pages.
/**
 * Three-way OCR comparison on the same pages (#7941): the Internet Archive's own OCR, our stored read, and a human-
 * typed edition, each judged by #7866's judge (Opus via claude -p, route-judge judgePrompt, against the page image,
 * blind to which text it is), and the two machine texts scored against the typed edition.
 *
 * FAIRNESS (Derek, job inbox 2026-11-02 13:48Z; fixed before any judge call):
 *   - every text goes through ONE normaliser (`normalise` below) before it is judged and before it is scored: the
 *     page furniture (running heads, page numbers, signatures, catchwords) dropped, line-end hyphens joined, long s
 *     to s, abbreviations left as printed, and the text re-wrapped to WRAP columns so all three arms have the same
 *     line breaks and no paragraph layout. Raw CER (no normaliser) is reported beside it.
 *   - rates are cut by the Archive's OCR engine and version, by century, and with / without the books that sit in
 *     any engine-selection reference set (scripts/eval/benchmark/*.json).
 *   - set C: 30 pages drawn at random from Archive-sourced English books 1800–1930 (no typed edition): Archive vs
 *     ours only, same normaliser and judge.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/judge-cal-7866bar-7263/three-way.mjs <stage>
 *     ia | align   set A: the Archive leaf for #7263's 60 print pages, by similarity to the typed page (ALIGN_F1)
 *     added        set B: #5124's English IA pages with a typed reference (one per book, seeded), N_B pages
 *     random       set C: N_C random pages of Archive-sourced English books 1800–1930
 *     judge        #7866's judge on every normalised text of A, B (3 arms) and C (2 arms)
 *     adjudicate   misleads / wrong_text flags, all arms of a page in one call, unlabelled and shuffled, by Opus and by
 *                  Sonnet, each shown the image cropped to the flagged line; pages in seeded order until the Opus cap
 *     score        results/three-way.json (+ three-way-pages.jsonl and the committed verdict / alignment rows; no text)
 *     show <uid>   print the three normalised texts of one page (for the eye check)
 * Nothing here writes to Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { judgeAbsolute, paceCheck, eligiblePage, imageUrl } from '../confidence-7866/lib.mjs';
import { opusCall, QUOTA } from '../route-judge-6740/judge.mjs';
import { cerLines } from '../judge-calibration-7263/lib.mjs';
import { normalizeForScript, windowedErrorRate, NORMALIZE_FOR_SCRIPT_VERSION } from '../lib/metrics.mjs';
import { bodyText, isInterior } from '../ground-truth-5935/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const RESULTS = path.join(HERE, 'results');
const OUT = path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'judge-cal-7866bar');
const R5124 = path.join(ROOT, 'scripts/eval/results/en-ocr-ref-5124');
const F = { leaves: path.join(OUT, 'ia'), align: path.join(OUT, 'three-way-align.jsonl'), added: path.join(OUT, 'three-way-added.json'), random: path.join(OUT, 'three-way-random.json'),
  verdicts: path.join(OUT, 'three-way-verdicts.jsonl'), adj: path.join(OUT, 'three-way-adjudications.jsonl') };
fs.mkdirSync(F.leaves, { recursive: true }); fs.mkdirSync(path.join(OUT, 'items'), { recursive: true });
export const SEED = Object.freeze({ added: 79411, queue: 79412, adjOrder: 79413, boot: 79414, random: 79415, randomPages: 79416 });
/** The brief's cap (300 Opus calls) set against Derek's additions: A's aligned pages x 3 arms + N_B x 3 + N_C x 2,
 *  the rest for adjudication. */
export const OPUS_CAP = 300, N_B = 35, N_C = 30, WRAP = 72;
/** ALIGN_F1 (fixed before any Archive text was judged): the leaf whose words best match the typed page (F1 of the
 *  two word multisets, normalizeForScript latin, words of >= 3 letters), searched over EVERY leaf of the item; the
 *  page is aligned when that F1 >= ALIGN_F1. The leaf our image was cut from (photo URL page/n<k>) is recorded. */
export const ALIGN_F1 = 0.5;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const append = (f, r) => fs.appendFileSync(f, JSON.stringify({ ...r, at: new Date().toISOString() }) + '\n');
const shuffle = (xs, rng) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const printDrawn = () => J(path.join(HERE, 'results/draw.json')).drawn.filter((d) => d.stratum === 'print');
const item = (uid) => J(path.join(OUT, 'items', `${uid}.json`));
async function mongo() { const c = await MongoClient.connect(process.env.MONGODB_URI); return { c, db: c.db(process.env.MONGODB_DB || 'bookstore') }; }
const UA = 'SourceLibrary-eval/7941 (https://sourcelibrary.org; internal quality measurement)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yearOf = (p) => { const m = String(p ?? '').match(/\b(1[0-9]{3})\b/); return m ? +m[1] : null; };
const centuryOf = (y) => (y ? `${Math.floor(y / 100) + 1}th` : 'unknown');

// ── the Archive's text: one string per djvu OBJECT (leaf), lines as the Archive gives them (en-ocr-reference-5124) ──
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
function leafTexts(xml) {
  const out = [];
  for (const o of xml.split(/<OBJECT\b/).slice(1)) {
    const paras = [];
    for (const p of o.split(/<PARAGRAPH\b/).slice(1)) {
      const lines = [];
      for (const l of p.split(/<LINE\b/).slice(1)) { const w = [...l.matchAll(/<WORD[^>]*>([\s\S]*?)<\/WORD>/g)].map((m) => decode(m[1]).trim()).filter(Boolean); if (w.length) lines.push(w.join(' ')); }
      if (lines.length) paras.push(lines.join('\n'));
    }
    out.push(paras.join('\n\n'));
  }
  return out;
}
async function leaves(iaId) {
  const f = path.join(F.leaves, `${iaId}.leaves.json`);
  if (fs.existsSync(f)) { const r = J(f); if (r.leaves) return r; }   // a failed fetch is retried
  let res = null, xmlName = `${iaId}_djvu.xml`;
  const meta = await fetch(`https://archive.org/metadata/${iaId}`, { headers: { 'User-Agent': UA } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const xmls = (meta?.files || []).filter((x) => /_djvu\.xml$/.test(x.name || ''));
  if (xmls.length) xmlName = (xmls.find((x) => x.name === xmlName) || xmls[0]).name;
  for (let a = 0; a < 3 && !res?.ok; a++) {
    if (a) await sleep(10000);
    res = await fetch(`https://archive.org/download/${iaId}/${encodeURIComponent(xmlName)}`, { headers: { 'User-Agent': UA }, redirect: 'follow' }).catch(() => null);
  }
  const x = xmls.find((y) => y.name === xmlName);
  const rec = res?.ok ? { ia: iaId, xml: xmlName, n_xml: xmls.length, ocr: [].concat(meta?.metadata?.ocr || []).join('; ') || null, ocr_module_version: meta?.metadata?.ocr_module_version || null,
    ocr_date: x?.mtime ? new Date(+x.mtime * 1000).toISOString().slice(0, 10) : null, leaves: leafTexts(await res.text()) }
    : { ia: iaId, xml: null, error: `HTTP ${res?.status ?? 'fetch failed'}`, leaves: null };
  fs.writeFileSync(f, JSON.stringify(rec));
  return rec;
}
/** The Archive OCR engine of an item: ABBYY FineReader <version>, or ia-ocr (tesseract) <module version>. */
export function iaEngine(rec) {
  const o = String(rec?.ocr || '');
  const ab = o.match(/ABBYY FineReader\s*([\d.]+)/i);
  if (ab) return `ABBYY FineReader ${ab[1].split('.').slice(0, 2).join('.')}`;
  if (/tesseract/i.test(o) || rec?.ocr_module_version) return `ia-ocr (tesseract) ${rec?.ocr_module_version || '?'}`;
  return 'unknown';
}

// ── THE NORMALISER (one for all three arms) ──
// Furniture is marked differently by each source, so it is removed by source; everything after that is one function.
//   ours:    our markup tags the furniture (<header>, <page-num>, <sig>, <catchword>, <footer>); those blocks and the
//            metadata tags are dropped; marginalia, notes and footnotes are KEPT as text (their tags removed).
//   human:   the typed editions carry no furniture (DTA / EEBO-TCP / CAMENA drop fw; #5124's references drop running
//            heads); their notes are kept as text after the page, as the #7263 human arm had them.
//   archive: the Archive marks nothing, so a fixed rule (archiveFurniture) drops: a bare page number as the first or
//            last line; a first line (or second, after a bare number) of <= 10 words that holds a 1–4 digit number,
//            is >= 60% capitals, or matches the first line of a leaf two either side (F1 >= 0.5, a repeated running
//            head); a last line of <= 8 words that is >= 60% capitals or (<= 6 words) ends in a 1–4 digit number (a
//            running foot); a last line that is a signature mark (A, B2, Aa 3 ...); a last line of <= 2 words whose first
//            word is the next leaf's first body word (a catchword).
// Then for every arm: NFC, long s to s, curly quotes to straight, æ/œ to ae/oe (the typed editions write them out: a give-away otherwise),
// markdown emphasis asterisks dropped, words broken by a line-end hyphen (- ¬ ⸗ =) joined, all whitespace and line
// breaks collapsed to one space, and the text re-wrapped to WRAP columns. Case, punctuation, u/v, i/j, ligatures and
// abbreviations are left as the text has them.
const OUR_FURNITURE = /<(header|page-num|pagenum|sig|signature|catchword|footer|running-head)\b[^>]*>[\s\S]*?<\/\1>/gi;
const OUR_META = /<(vocab|warning|language|script|page-type|columns|meta|image-desc|scan-quality|summary|keywords|detected-images|figure)\b[^>]*>[\s\S]*?<\/\1>/gi;
export function oursFurniture(t) {
  return String(t || '').replace(OUR_FURNITURE, '\n').replace(OUR_META, '\n').replace(/<[^<>]*\/>/g, ' ').replace(/->|<-/g, ' ')
    .replace(/<\/?[a-zA-Z][^<>]*>/g, ' ').replace(/^#+\s*/gm, '').replace(/\*\*|__/g, '').replace(/^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*$/gm, '').replace(/\s*\|\s*/g, ' ')
    .replace(/&[a-z]{2,8};|&#\d+;/gi, ' ');
}
const wordsOf = (l) => l.split(/\s+/).filter(Boolean);
const capsShare = (l) => { const L = l.replace(/[^\p{L}]/gu, ''); return L.length >= 3 ? L.replace(/[^\p{Lu}]/gu, '').length / L.length : 0; };
const bareNum = (l) => /^[[(]?\d{1,4}[\])]?[.,]?$/.test(l.trim());
const sigMark = (l) => /^[A-Z]{1,3}[a-z]?\s*[0-9ijv]{0,3}\.?$/.test(l.trim()) && l.trim().length <= 6;
const linesOf = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);
export function archiveFurniture(allLeaves, k) {
  const L = linesOf(allLeaves[k]); const dropped = [];
  const firstOf = (j) => linesOf(allLeaves[j])[0] || '';
  const head = (l) => { const w = wordsOf(l); if (w.length > 10) return false;
    if (w.some((x) => /^[[(]?\d{1,4}[\])]?[.,]?$/.test(x)) || capsShare(l) >= 0.6) return true;
    return [k - 2, k + 2].some((j) => j >= 0 && j < allLeaves.length && f1(toks(l), firstOf(j)) >= 0.5 && toks(l).length >= 1); };
  if (L.length && bareNum(L[0])) dropped.push(L.shift());
  if (L.length && head(L[0])) dropped.push(L.shift());
  if (L.length && bareNum(L[L.length - 1])) dropped.push(L.pop());
  if (L.length && (() => { const l = L[L.length - 1], w = wordsOf(l); return w.length <= 8 && (capsShare(l) >= 0.6 || (w.length <= 6 && /^[[(]?\d{1,4}[\])]?[.,]?$/.test(w[w.length - 1]))); })()) dropped.push(L.pop());   // a running foot
  if (L.length && sigMark(L[L.length - 1])) dropped.push(L.pop());
  if (L.length) {
    const last = L[L.length - 1], next = linesOf(allLeaves[k + 1]);
    let i = 0; if (next[i] && bareNum(next[i])) i++; if (next[i] && wordsOf(next[i]).length <= 10 && (capsShare(next[i]) >= 0.6 || /\d/.test(next[i]))) i++;
    const nw = normalizeForScript(next[i] || '', 'latin').split(' ')[0];
    if (wordsOf(last).length <= 2 && nw && normalizeForScript(last, 'latin').split(' ')[0] === nw) dropped.push(L.pop());
  }
  return { text: L.join('\n'), dropped };
}
export function wrap(s, w = WRAP) {
  const out = []; let line = '';
  for (const x of s.split(' ').filter(Boolean)) { if (line && line.length + 1 + x.length > w) { out.push(line); line = x; } else line = line ? `${line} ${x}` : x; }
  if (line) out.push(line);
  return out.join('\n');
}
export const universal = (t) => wrap(String(t || '').normalize('NFC').replace(/ſ/g, 's').replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"').replace(/æ/g, 'ae').replace(/Æ/g, 'Ae').replace(/œ/g, 'oe').replace(/Œ/g, 'Oe')
  .replace(/(?<!\d)\*+|\*+(?!\d)/g, '')   // every asterisk run in every arm (emphasis in ours; a printed asterisk is dropped alike)
.replace(/(\p{L})[-¬⸗=]\s*\n\s*(?=\p{L})/gu, '$1').replace(/\s+/g, ' ').trim());
export function normalise(arm, x) {
  if (arm === 'ours') return { text: universal(oursFurniture(x.text)), dropped: [] };
  if (arm === 'human') return { text: universal([x.text, ...(x.notes || [])].join('\n')), dropped: [] };
  const a = archiveFurniture(x.leaves, x.leaf); return { text: universal(a.text), dropped: a.dropped };
}

// ── similarity and the scores against the typed reference ──
const toks = (s) => normalizeForScript(String(s || ''), 'latin').split(' ').filter((w) => w.length >= 3);
function f1(refToks, cand) {
  const c = toks(cand); if (!c.length || !refToks.length) return 0;
  const m = new Map(); for (const w of refToks) m.set(w, (m.get(w) || 0) + 1);
  let hit = 0; for (const w of c) { const k = m.get(w); if (k) { hit++; m.set(w, k - 1); } }
  const p = hit / c.length, r = hit / refToks.length; return p + r ? (2 * p * r) / (p + r) : 0;
}
/** Character CER, order-free: each reference line located in the text (#7880 cerLines' windowing) with case,
 *  punctuation and every letter form kept (only whitespace collapsed). */
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
function cerChars(refLines, text) {
  const C = flat(text); let edits = 0, chars = 0;
  for (const l of refLines) { const L = flat(l); const n = L.replace(/ /g, '').length; if (!n) continue; edits += windowedErrorRate(L, C).windowedCer * n; chars += n; }
  return chars ? Math.min(1, edits / chars) : 0;
}
/** Printed numbers: every Arabic-digit run of the (normalised) typed page; right when the text holds the same digit
 *  string (multiset). ref_numbers = how many the typed page prints. */
function numbers(ref, text) {
  const nums = (s) => String(s || '').match(/\d+/g) || [];
  const R = nums(ref), m = new Map(); for (const x of nums(text)) m.set(x, (m.get(x) || 0) + 1);
  let wrong = 0; for (const x of R) { const k = m.get(x); if (k) m.set(x, k - 1); else wrong++; }
  return { ref_numbers: R.length, wrong };
}
/** Book ids in any engine-selection reference set: every scripts/eval/benchmark/*.json that names the id. */
let _bench;
function benchmarksOf(bookId) {
  if (!_bench) {
    _bench = new Map(); const dir = path.join(ROOT, 'scripts/eval/benchmark');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of s.matchAll(/[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)) { if (!_bench.has(m[0])) _bench.set(m[0], new Set()); _bench.get(m[0]).add(f.replace(/\.json$/, '')); }
    }
  }
  return [...(_bench.get(bookId) || [])].sort();
}

// ── set A: #7263's 60 print pages ──
async function ia() {
  const { c, db } = await mongo();
  const ds = printDrawn();
  const books = new Map((await db.collection('books').find({ id: { $in: ds.map((d) => d.book_id) } }, { projection: { _id: 0, id: 1, ia_identifier: 1 } }).toArray()).map((b) => [b.id, b]));
  await c.close();
  for (const d of ds) {
    const id = books.get(d.book_id)?.ia_identifier; if (!id) continue;
    const r = await leaves(id);
    console.log(d.uid, id, r.leaves ? `${r.leaves.length} leaves ${iaEngine(r)}` : r.error);
  }
}
async function align() {
  const { c, db } = await mongo();
  const ds = printDrawn();
  const books = new Map((await db.collection('books').find({ id: { $in: ds.map((d) => d.book_id) } }, { projection: { _id: 0, id: 1, ia_identifier: 1, published: 1 } }).toArray()).map((b) => [b.id, b]));
  const pages = new Map((await db.collection('pages').find({ id: { $in: ds.map((d) => d.page_id) } }, { projection: { _id: 0, id: 1, photo: 1 } }).toArray()).map((p) => [p.id, p]));
  await c.close();
  const rows = [];
  for (const d of ds) {
    const b = books.get(d.book_id), id = b?.ia_identifier ?? null;
    const row = { uid: d.uid, set: 'A', lang: d.lang, book_id: d.book_id, page_id: d.page_id, year: yearOf(b?.published), ia: id };
    if (!id) { rows.push({ ...row, status: 'no_ia_identifier' }); continue; }
    const L = await leaves(id);
    if (!L.leaves) { rows.push({ ...row, status: 'no_djvu_xml', why: L.error }); continue; }
    const photo = String(pages.get(d.page_id)?.photo || ''), m = photo.includes(`/${id}/`) ? photo.match(/\/page\/n(\d+)\//) : null;
    const rt = toks(item(d.uid).ref.text), sc = L.leaves.map((t) => f1(rt, t));
    const best = sc.reduce((bb, s, i) => (s > sc[bb] ? i : bb), 0), photoLeaf = m ? +m[1] : null;
    rows.push({ ...row, status: sc[best] >= ALIGN_F1 ? 'aligned' : 'not_aligned', leaf: best, f1: +sc[best].toFixed(4), photo_leaf: photoLeaf,
      photo_f1: photoLeaf != null && photoLeaf < sc.length ? +sc[photoLeaf].toFixed(4) : null, n_leaves: L.leaves.length, ia_engine: iaEngine(L), ia_ocr: L.ocr, ia_ocr_module: L.ocr_module_version, ia_ocr_date: L.ocr_date });
  }
  fs.writeFileSync(F.align, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const by = {}; for (const r of rows) { by[r.lang] ??= {}; by[r.lang][r.status] = (by[r.lang][r.status] || 0) + 1; }
  console.log(JSON.stringify(by));
}

// ── set B: #5124's English IA pages with a typed reference ──
const servesArchive = (p) => /ia_djvu|^ia\b|^ia-/i.test(String(p.ocr?.source || '')) || /^ia-ocr/.test(String(p.ocr?.model || ''));
async function added() {
  const bench = J(path.join(ROOT, 'scripts/eval/benchmark/english-ia-5124.json')).rows;
  const fetched = new Map(jsonl(path.join(R5124, 'fetch.jsonl')).map((r) => [r.slug, r]));
  const inA = new Set(printDrawn().map((d) => d.book_id));
  // eligible: #5124 kept it (not excluded), its leaf check by eye said ok, it has a reference; one page per book
  const pool = bench.filter((r) => !r.excluded && r.reference && r.leaf_check?.status === 'ok' && fs.existsSync(path.join(R5124, 'refs', `${r.slug}.txt`)) && !inA.has(r.book_id));
  const seen = new Set(), order = shuffle(pool, makeRng(SEED.added)).filter((r) => !seen.has(r.book_id) && seen.add(r.book_id));
  const { c, db } = await mongo();
  const out = [], skipped = [];
  for (const r of order) {
    if (out.length >= N_B) break;
    const fe = fetched.get(r.slug) || {};
    const p = fe.page_id ? await db.collection('pages').findOne({ id: fe.page_id }, { projection: { _id: 0, translation: 0, ocr_history: 0 } }) : null;
    const b = await db.collection('books').findOne({ id: r.book_id, visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1, published: 1 } });
    const why = !b ? 'book not live' : !p ? 'page missing' : !eligiblePage(p) ? 'no eligible stored read' : servesArchive(p) ? 'we serve the Archive text on this page' : null;
    if (why) { skipped.push({ slug: r.slug, book_id: r.book_id, why }); continue; }
    const L = await leaves(r.ia);
    if (!L.leaves) { skipped.push({ slug: r.slug, book_id: r.book_id, why: 'no_djvu_xml' }); continue; }
    const ref = fs.readFileSync(path.join(R5124, 'refs', `${r.slug}.txt`), 'utf8');
    const rt = toks(ref), sc = L.leaves.map((t) => f1(rt, t)), best = sc.reduce((bb, s, i) => (s > sc[bb] ? i : bb), 0);
    const row = { uid: `en5124-${r.slug}`, set: 'B', lang: 'English', book_id: r.book_id, page_id: p.id, page_number: p.page_number, slug: r.slug, ia: r.ia, ref_source: r.source,
      year: yearOf(b.published) ?? r.catalogue?.published ?? null, image: r.image_url, engine: p.ocr?.model ?? null, ocr_source: p.ocr?.source ?? null, ocr_hash: sha(p.ocr.data).slice(0, 16),
      leaf: best, f1: +sc[best].toFixed(4), leaf_5124: r.ia_leaf, n_leaves: L.leaves.length, ia_engine: iaEngine(L), ia_ocr: L.ocr, ia_ocr_module: L.ocr_module_version, ia_ocr_date: L.ocr_date };
    if (sc[best] < ALIGN_F1) { skipped.push({ slug: r.slug, book_id: r.book_id, why: 'not_aligned', f1: row.f1 }); continue; }
    fs.writeFileSync(path.join(OUT, 'items', `${row.uid}.json`), JSON.stringify({ uid: row.uid, read: p.ocr.data, ref: { text: ref } }));
    await imageFor(row.uid, row.image);
    out.push(row); console.log('B', out.length, row.uid, row.engine, 'f1', row.f1, 'leaf', best, 'vs 5124', r.ia_leaf, row.ia_engine);
  }
  await c.close();
  fs.writeFileSync(F.added, JSON.stringify({ seed: SEED.added, n: N_B, added: out, skipped }, null, 1));
  console.log(`B: ${out.length} of ${N_B}; skipped ${skipped.length}`, JSON.stringify(skipped.reduce((m, s) => ((m[s.why] = (m[s.why] || 0) + 1), m), {})));
}

// ── set C: random pages of Archive-sourced English books 1800–1930 (no typed edition) ──
// Books: live, English, ia_identifier set, published 1800–1930, not in A or B; shuffled by makeRng(SEED.random) over
// the id-sorted frame. A page: interior (#5935 isInterior), eligiblePage (a stored read, not a plate or front matter),
// an image cut from this Archive item (photo .../<ia>/page/n<k>/), drawn uniformly (makeRng(SEED.randomPages ^ id)),
// kept when the Archive leaf k or our read holds >= 300 letters (either side, so neither text decides alone), at most
// 12 tries a book. The leaf is our image's own (k); it moves only when another leaf matches our read by F1 >= 0.5 and
// beats leaf k by 0.2 (the djvu index drifting from the image index, #5124 "shifted").
async function random() {
  const { c, db } = await mongo();
  const inAB = new Set([...printDrawn().map((d) => d.book_id), ...(fs.existsSync(F.added) ? J(F.added).added.map((r) => r.book_id) : [])]);
  const frame = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: 'English', ia_identifier: { $exists: true, $nin: [null, ''] } }, { projection: { _id: 0, id: 1, published: 1, ia_identifier: 1, pages_count: 1 } }).toArray())
    .filter((b) => { const y = yearOf(b.published); return y && y >= 1800 && y <= 1930 && !inAB.has(b.id); }).sort((a, b) => a.id.localeCompare(b.id));
  console.log('frame', frame.length, 'books');
  const out = [], skipped = [];
  const letters = (s) => String(s || '').replace(/[^\p{L}]/gu, '').length;
  for (const b of shuffle(frame, makeRng(SEED.random))) {
    if (out.length >= N_C) break;
    const pages = (await db.collection('pages').find({ book_id: b.id }, { projection: { _id: 0, translation: 0, ocr_history: 0 } }).toArray())
      .filter((p) => isInterior(p.page_number, b.pages_count) && eligiblePage(p) && String(p.photo || '').includes(`/${b.ia_identifier}/page/n`)).sort((x, y) => x.page_number - y.page_number);
    if (!pages.length) { skipped.push({ book_id: b.id, why: 'no eligible page with an image of this Archive item' }); continue; }
    if (pages.some(servesArchive) && pages.filter(servesArchive).length > pages.length / 2) { skipped.push({ book_id: b.id, why: 'we serve the Archive text on this book' }); continue; }
    const L = await leaves(b.ia_identifier);
    if (!L.leaves) { skipped.push({ book_id: b.id, why: 'no_djvu_xml' }); continue; }
    let pick = null, tries = 0;
    for (const p of shuffle(pages, makeRng((SEED.randomPages ^ parseInt(sha(b.id).slice(0, 8), 16)) >>> 0))) {
      if (tries++ >= 12) break;
      if (servesArchive(p)) continue;
      const k = +String(p.photo).match(/\/page\/n(\d+)\//)[1];
      if (k >= L.leaves.length) continue;
      const body = bodyText(p.ocr.data);
      if (Math.max(letters(body), letters(L.leaves[k])) < 300) continue;
      const rt = toks(body), sc = L.leaves.map((t) => f1(rt, t)), best = sc.reduce((bb, s, i) => (s > sc[bb] ? i : bb), 0);
      const leaf = best !== k && sc[best] >= 0.5 && sc[best] > sc[k] + 0.2 ? best : k;
      pick = { p, k, leaf, f1_photo: +sc[k].toFixed(4), f1_best: +sc[best].toFixed(4), best };
      break;
    }
    if (!pick) { skipped.push({ book_id: b.id, why: 'no page passed in 12 tries' }); continue; }
    const row = { uid: `rnd-${b.id}`, set: 'C', lang: 'English', book_id: b.id, page_id: pick.p.id, page_number: pick.p.page_number, ia: b.ia_identifier, year: yearOf(b.published),
      image: imageUrl(pick.p), engine: pick.p.ocr?.model ?? null, ocr_source: pick.p.ocr?.source ?? null, ocr_hash: sha(pick.p.ocr.data).slice(0, 16),
      photo_leaf: pick.k, leaf: pick.leaf, f1_vs_ours_photo: pick.f1_photo, f1_vs_ours_best: pick.f1_best, best_leaf: pick.best, n_leaves: L.leaves.length,
      ia_engine: iaEngine(L), ia_ocr: L.ocr, ia_ocr_module: L.ocr_module_version, ia_ocr_date: L.ocr_date };
    fs.writeFileSync(path.join(OUT, 'items', `${row.uid}.json`), JSON.stringify({ uid: row.uid, read: pick.p.ocr.data }));
    try { await imageFor(row.uid, row.image); } catch (e) { skipped.push({ book_id: b.id, why: `image: ${String(e.message).slice(0, 60)}` }); continue; }
    out.push(row); console.log('C', out.length, row.uid, row.year, row.engine, row.ia_engine, 'leaf', row.leaf, 'photo', row.photo_leaf, 'f1', row.f1_vs_ours_photo);
  }
  await c.close();
  fs.writeFileSync(F.random, JSON.stringify({ seed: [SEED.random, SEED.randomPages], n: N_C, frame_books: frame.length, drawn: out, skipped }, null, 1));
  console.log(`C: ${out.length}; skipped ${skipped.length}`, JSON.stringify(skipped.reduce((m, s) => ((m[s.why] = (m[s.why] || 0) + 1), m), {})));
}

const MAX_IMAGE_BYTES = 4e6, RESIZE_PX = 3000;   // run.mjs imageFor
async function imageFor(uid, url) {
  const f = path.join(OUT, 'img', `${uid}.jpg`);
  let buf = fs.existsSync(f) ? fs.readFileSync(f) : null;
  if (!buf) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60e3) });
    if (!r.ok) throw new Error(`image HTTP ${r.status} ${url.slice(0, 100)}`);
    buf = Buffer.from(await r.arrayBuffer()); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    const { default: sharp } = await import('sharp');
    buf = await sharp(buf).resize(RESIZE_PX, RESIZE_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(); fs.writeFileSync(f, buf);
  }
  return buf;
}

// ── the pages: every row with its arms' raw and normalised texts ──
function pageSet() {
  const leavesOf = (ia) => J(path.join(F.leaves, `${ia}.leaves.json`)).leaves;
  const meta = (r) => ({ uid: r.uid, set: r.set, lang: r.lang, book_id: r.book_id, year: r.year, ia_engine: r.ia_engine, image: r.image, benchmarks: benchmarksOf(r.book_id) });
  const pages = [];
  for (const r of jsonl(F.align).filter((x) => x.status === 'aligned')) {
    const it = item(r.uid), d = printDrawn().find((x) => x.uid === r.uid), Ls = leavesOf(r.ia);
    pages.push({ ...meta({ ...r, image: d.image }), ref: { text: it.ref.text, notes: it.ref.notes || [] },
      raw: { archive: Ls[r.leaf], ours: it.read, human: [it.ref.text, ...(it.ref.notes || [])].join('\n') }, src: { archive: { leaves: Ls, leaf: r.leaf }, ours: { text: it.read }, human: { text: it.ref.text, notes: it.ref.notes || [] } } });
  }
  for (const r of fs.existsSync(F.added) ? J(F.added).added : []) {
    const it = item(r.uid), Ls = leavesOf(r.ia);
    pages.push({ ...meta(r), ref: { text: it.ref.text, notes: [] }, raw: { archive: Ls[r.leaf], ours: it.read, human: it.ref.text }, src: { archive: { leaves: Ls, leaf: r.leaf }, ours: { text: it.read }, human: { text: it.ref.text } } });
  }
  for (const r of fs.existsSync(F.random) ? J(F.random).drawn : []) {
    const it = item(r.uid), Ls = leavesOf(r.ia);
    pages.push({ ...meta(r), ref: null, raw: { archive: Ls[r.leaf], ours: it.read }, src: { archive: { leaves: Ls, leaf: r.leaf }, ours: { text: it.read } } });
  }
  for (const p of pages) { p.norm = {}; p.dropped = {}; for (const arm of Object.keys(p.src)) { const n = normalise(arm, p.src[arm]); p.norm[arm] = n.text; p.dropped[arm] = n.dropped; } }
  return pages;
}
function show() {
  const uid = process.argv[3]; const p = pageSet().find((x) => x.uid === uid);
  if (!p) { console.log('no such page'); return; }
  for (const arm of Object.keys(p.norm)) console.log(`\n===== ${arm} (dropped: ${JSON.stringify(p.dropped[arm])})\n${p.norm[arm]}`);
}

// ── stage judge ──
const opusSpent = () => jsonl(F.verdicts).filter((r) => r.verdict || r.usage).length + jsonl(F.adj).filter((r) => r.judge === 'opus' && r.reply).length;
async function guarded(jobs, label, cap = true) {
  const limits = await import('../../lib/model-limits.mjs');
  const state = {}; let i = 0, stop = null;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (!stop && i < jobs.length) {
      if (cap && opusSpent() >= OPUS_CAP) { stop = `Opus cap ${OPUS_CAP}`; break; }
      const why = await paceCheck(limits, state); if (why) { stop = why; break; }
      if (i >= jobs.length) break;
      const j = jobs[i++];
      try { await j(); } catch (e) { console.log(`  ${label} ERR ${String(e.message || e).slice(0, 160)}`); if (/quota/.test(e.message)) stop = 'quota'; }
    }
  }));
  console.log(`${label}: ${stop ? `STOPPED: ${stop}` : 'done'}; Opus calls so far ${opusSpent()}; meter ${JSON.stringify(state.meter ?? null)}`);
  return stop;
}
async function judge() {
  const set = pageSet();
  const done = new Set(jsonl(F.verdicts).filter((r) => r.verdict).map((r) => r.id));
  const tries = new Map(); for (const r of jsonl(F.verdicts)) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  // queue: A, then B, then C (a stop leaves whole pages, not one arm of many); the arms of a page in seeded order
  const jobs = [];
  for (const s of ['A', 'B', 'C']) for (const p of shuffle(set.filter((x) => x.set === s), makeRng(SEED.queue))) for (const arm of shuffle(Object.keys(p.norm), makeRng(SEED.queue + parseInt(sha(p.uid).slice(0, 6), 16)))) jobs.push({ id: `${arm}-${p.uid}`, arm, p });
  const todo = jobs.filter((j) => !done.has(j.id) && (tries.get(j.id) ?? 0) < 3);
  console.log(`judge: ${todo.length} of ${jobs.length} to do; Opus so far ${opusSpent()}`);
  await guarded(todo.map((j) => async () => {
    const r = await judgeAbsolute({ lang: j.p.lang, text: j.p.norm[j.arm] }, await imageFor(j.p.uid, j.p.image));
    if (r.cls === 'quota') throw new Error('quota reply');
    append(F.verdicts, { id: j.id, arm: j.arm, uid: j.p.uid, text_sha: sha(j.p.norm[j.arm]).slice(0, 16), ...r });
    console.log(`  ${j.id}: ${r.verdict ? `accept=${r.verdict.accept} f${r.verdict.fidelity} severe=${(r.verdict.defects || []).filter(severe).length}` : 'UNPARSED ' + (r.cls || '')}`);
  }), 'judge');
}
const severe = (d) => d.severity === 'misleads' || d.severity === 'wrong_text';

// ── stage adjudicate ──
export const ADJ3_PROMPT = (lang, points) => `Each image named below is part of one printed page in ${lang}. Transcriptions of the page were checked against the page image, and the checker raised the points below. For each point, open its image with Read, look at it yourself and say what the page actually prints there.

${points.map((f, i) => `Point ${i + 1} (image ./${f.file}). The transcription reads: "${f.quote}". The checker says: ${f.what}`).join('\n')}

For each point: "typed_right" when the page prints what the transcription reads (the checker is wrong), "typed_wrong" when the page prints something else or the transcription adds or drops something the page has, "cannot_tell" when the image does not show it. Answer with JSON only: {"points":[{"n":1,"verdict":"typed_right|typed_wrong|cannot_tell","page_prints":"<what you see, briefly>"}]}`;
async function crop(uid, text, quote) {   // meaning.mjs crop, located in the flagged (normalised) text itself
  const { default: sharp } = await import('sharp');
  const buf = fs.readFileSync(path.join(OUT, 'img', `${uid}.jpg`)), meta = await sharp(buf).metadata();
  const lines = String(text).split('\n').filter((l) => l.trim()), q = String(quote || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const li = q ? lines.findIndex((l) => l.includes(q.slice(0, Math.min(20, q.length)))) : -1;
  if (li < 0) return { buf, whole: true };
  const f = (li + 0.5) / lines.length, top = Math.max(0, Math.floor((f - 0.15) * meta.height)), h = Math.min(meta.height - top, Math.ceil(0.30 * meta.height));
  return { buf: await sharp(buf).extract({ left: 0, top, width: meta.width, height: h }).jpeg({ quality: 90 }).toBuffer(), whole: false, band: [+(top / meta.height).toFixed(3), +((top + h) / meta.height).toFixed(3)] };
}
function claudeCall(model, prompt, cwd) {   // opusCall with the model as a parameter (Sonnet: the second adjudicator)
  if (model === 'opus') return opusCall(prompt, cwd);
  return new Promise((resolve) => {
    const env = { ...process.env }; for (const k of Object.keys(env)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete env[k];
    const child = spawn('claude', ['-p', '--model', model, '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
    let out = '', err = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 900e3);
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; }); child.stdin.end(prompt);
    child.on('close', (code) => { clearTimeout(timer); let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ } const text = String(j.result ?? '');
      resolve({ text, cls: (j.is_error || code !== 0) && QUOTA.test(text + out + err) ? 'quota' : code !== 0 ? `exit_${code}` : null, model: Object.keys(j.modelUsage || {})[0] ?? null }); });
  });
}
const flagsOf = () => jsonl(F.verdicts).filter((r) => r.verdict).flatMap((r) => (r.verdict.defects || []).map((d, k) => ({ d, k })).filter(({ d }) => severe(d))
  .map(({ d, k }) => ({ key: `${r.id}#${k}`, arm: r.arm, uid: r.uid, quote: d.quote, what: d.what || '', class: d.class, severity: d.severity })));
async function adjudicate() {
  const set = new Map(pageSet().map((p) => [p.uid, p]));
  const byPage = new Map(); for (const f of flagsOf()) { if (!byPage.has(f.uid)) byPage.set(f.uid, []); byPage.get(f.uid).push(f); }
  const have = new Set(jsonl(F.adj).filter((r) => r.points).map((r) => `${r.uid}|${r.judge}`));
  const jobs = { opus: [], sonnet: [] };
  // pages in seeded order, every page whose arms have all been judged; Opus takes them until the cap, Sonnet the same pages
  const judged = new Set(jsonl(F.verdicts).filter((r) => r.verdict).map((r) => r.id));
  const order = shuffle([...byPage.keys()].sort(), makeRng(SEED.adjOrder)).filter((uid) => set.has(uid) && Object.keys(set.get(uid).norm).every((a) => judged.has(`${a}-${uid}`)));
  for (const uid of order) {
    const p = set.get(uid), fl = shuffle(byPage.get(uid), makeRng(SEED.adjOrder + parseInt(sha(uid).slice(0, 6), 16)));   // arms interleaved, unlabelled
    for (const judge of ['opus', 'sonnet']) {
      if (have.has(`${uid}|${judge}`)) continue;
      jobs[judge].push(async () => {
        if (judge === 'sonnet' && !jsonl(F.adj).some((r) => r.uid === uid && r.judge === 'opus' && r.points)) return;   // Sonnet only where Opus adjudicated
        const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'adj7941-'));
        try {
          const pts = [];
          for (const [i, f] of fl.entries()) { const cr = await crop(uid, p.norm[f.arm], f.quote); const file = `crop${i + 1}.jpg`; fs.writeFileSync(path.join(ws, file), cr.buf); pts.push({ ...f, file, crop: cr.whole ? 'whole' : cr.band }); }
          const res = await claudeCall(judge, ADJ3_PROMPT(p.lang, pts), ws);
          if (res.cls === 'quota') throw new Error('quota reply');
          let j = null; try { j = JSON.parse(String(res.text).replace(/^```(json)?|```$/gm, '').trim()); } catch { const m = String(res.text).match(/\{[\s\S]*\}/); try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; } }
          const ans = pts.map((f, i) => ({ key: f.key, arm: f.arm, class: f.class, severity: f.severity, crop: f.crop, verdict: j?.points?.find((x) => +x.n === i + 1)?.verdict ?? null, page_prints: j?.points?.find((x) => +x.n === i + 1)?.page_prints ?? null }));
          append(F.adj, { uid, judge, model: res.model, reply: true, parsed: Boolean(j), points: ans, raw: j ? undefined : String(res.text).slice(0, 300) });
          console.log(`  adjudicate ${uid} ${judge}: ${ans.map((a) => `${a.arm[0]}:${a.verdict}`).join(',')}`);
        } finally { fs.rmSync(ws, { recursive: true, force: true }); }
      });
    }
  }
  console.log(`adjudicate: ${order.length} judged pages with flags; ${jobs.opus.length} Opus, ${jobs.sonnet.length} Sonnet to do; Opus so far ${opusSpent()}`);
  await guarded(jobs.opus, 'adjudicate opus');
  await guarded(jobs.sonnet, 'adjudicate sonnet', false);
}

// ── stage score ──
function boot(rows, stat, B = 2000) {
  const books = [...new Set(rows.map((r) => r.book_id))], by = new Map(books.map((b) => [b, rows.filter((r) => r.book_id === b)]));
  const rng = makeRng(SEED.boot), xs = [];
  for (let k = 0; k < B; k++) { const s = []; for (let i = 0; i < books.length; i++) s.push(...by.get(books[Math.floor(rng() * books.length)])); const v = stat(s); if (v != null && Number.isFinite(v)) xs.push(v); }
  xs.sort((a, b) => a - b); return xs.length ? [+xs[Math.floor(0.025 * xs.length)].toFixed(4), +xs[Math.min(xs.length - 1, Math.floor(0.975 * xs.length))].toFixed(4)] : null;
}
const ratio = (num, den, k = 1) => (rows) => { const d = rows.reduce((s, r) => s + den(r), 0); return d ? (k * rows.reduce((s, r) => s + num(r), 0)) / d : null; };
const r4 = (x) => (x == null ? null : +x.toFixed(4));
function armSummary(rs) {
  const w = (r) => r.words, ad = rs.filter((r) => r.adjudicated);
  const flagged = ratio((r) => r.flagged, w, 1000), real = ratio((r) => r.real, w, 1000), realOrSplit = ratio((r) => r.real + r.split, w, 1000);
  const o = { n_pages: rs.length, n_books: new Set(rs.map((r) => r.book_id)).size, words: rs.reduce((s, r) => s + r.words, 0),
    judge_accept: r4(rs.filter((r) => r.accept).length / rs.length), judge_bad: r4(rs.filter((r) => r.judge_bad).length / rs.length), judge_bad_ci95: boot(rs, (s) => s.filter((r) => r.judge_bad).length / s.length),
    mean_fidelity: r4(rs.reduce((s, r) => s + r.fidelity, 0) / rs.length),
    flagged: rs.reduce((s, r) => s + r.flagged, 0), flagged_per_1k: r4(flagged(rs)), flagged_per_1k_ci95: boot(rs, flagged),
    adjudicated_pages: ad.length, adjudicated_words: ad.reduce((s, r) => s + r.words, 0), adjudicated_flags: ad.reduce((s, r) => s + r.flagged, 0),
    confirmed: ad.reduce((s, r) => s + r.real, 0), split: ad.reduce((s, r) => s + r.split, 0), false_alarm: ad.reduce((s, r) => s + r.false_alarm, 0), unanswered: ad.reduce((s, r) => s + r.unanswered, 0),
    confirmed_per_1k: ad.length ? r4(real(ad)) : null, confirmed_per_1k_ci95: ad.length ? boot(ad, real) : null, confirmed_or_split_per_1k: ad.length ? r4(realOrSplit(ad)) : null,
    o7_numeral_flags: rs.reduce((s, r) => s + r.o7, 0) };
  if (rs[0].cer_norm != null) {
    const cr = ratio((r) => r.cer_raw * r.ref_chars, (r) => r.ref_chars), cn = ratio((r) => r.cer_norm * r.ref_chars, (r) => r.ref_chars), cc = ratio((r) => r.cer_conv * r.ref_chars, (r) => r.ref_chars);
    const nr = ratio((r) => r.numbers_wrong, (r) => r.ref_numbers), withN = rs.filter((r) => r.ref_numbers);
    Object.assign(o, { cer_raw: r4(cr(rs)), cer_raw_ci95: boot(rs, cr), cer_norm: r4(cn(rs)), cer_norm_ci95: boot(rs, cn), cer_conv: r4(cc(rs)), cer_conv_ci95: boot(rs, cc),
      cer_norm_median_page: r4([...rs.map((r) => r.cer_norm)].sort((a, b) => a - b)[Math.floor(rs.length / 2)]),
      ref_numbers: rs.reduce((s, r) => s + r.ref_numbers, 0), numbers_wrong: rs.reduce((s, r) => s + r.numbers_wrong, 0),
      number_error_rate: withN.length ? r4(nr(withN)) : null, number_error_rate_ci95: withN.length ? boot(withN, nr) : null, pages_with_numbers: withN.length });
  }
  return o;
}
function score() {
  const set = pageSet();
  const V = new Map(jsonl(F.verdicts).filter((r) => r.verdict).map((r) => [r.id, r]));
  const adj = jsonl(F.adj).filter((r) => r.points);
  const adjOf = new Map(), adjPages = new Set(); for (const r of adj) { adjPages.add(`${r.uid}|${r.judge}`); for (const p of r.points) { if (!adjOf.has(p.key)) adjOf.set(p.key, {}); adjOf.get(p.key)[r.judge] = p.verdict; } }
  const flaggedPages = new Set(flagsOf().map((f) => f.uid));
  const rows = [];
  for (const p of set) {
    const arms = Object.keys(p.norm);
    if (!arms.every((a) => V.has(`${a}-${p.uid}`))) continue;   // a page counts only with every arm judged
    // adjudicated: both adjudicators answered for this page (or the page has no flag in any arm: nothing to adjudicate)
    const adjudicated = !flaggedPages.has(p.uid) || (adjPages.has(`${p.uid}|opus`) && adjPages.has(`${p.uid}|sonnet`));
    const refNorm = p.ref ? universal([p.ref.text, ...(p.ref.notes || [])].join('\n')) : null;
    const words = p.ref ? normalizeForScript(refNorm, 'latin').split(' ').filter(Boolean).length : normalizeForScript(p.norm.ours, 'latin').split(' ').filter(Boolean).length;
    for (const arm of arms) {
      const v = V.get(`${arm}-${p.uid}`), defs = v.verdict.defects || [];
      const res = defs.map((d, k) => ({ d, k })).filter(({ d }) => severe(d)).map(({ k }) => adjOf.get(`${arm}-${p.uid}#${k}`) || {})
        .map((a) => (a.opus === 'typed_wrong' && a.sonnet === 'typed_wrong' ? 'real' : a.opus === 'typed_right' && a.sonnet === 'typed_right' ? 'false_alarm' : a.opus && a.sonnet ? 'split' : 'unanswered'));
      const machine = arm !== 'human' && p.ref;
      const nm = machine ? numbers(refNorm, p.norm[arm]) : null;
      const refLines = machine ? refNorm.split('\n') : null;
      const rawText = arm === 'ours' ? p.raw.ours.replace(/<[^<>]*>/g, ' ') : p.raw[arm];
      rows.push({ uid: p.uid, set: p.set, lang: p.lang, book_id: p.book_id, year: p.year, century: centuryOf(p.year), ia_engine: p.ia_engine, in_benchmark: p.benchmarks.length > 0, benchmarks: p.benchmarks,
        ours_empty: !String(p.norm.ours || '').trim(), arm, words, words_basis: p.ref ? 'typed reference' : 'our normalised read', text_sha: v.text_sha, accept: v.verdict.accept, fidelity: Number(v.verdict.fidelity),
        judge_bad: !v.verdict.accept || defs.some((d) => d.severity === 'wrong_text'), flagged: res.length, adjudicated,
        real: adjudicated ? res.filter((x) => x === 'real').length : 0, split: adjudicated ? res.filter((x) => x === 'split').length : 0, false_alarm: adjudicated ? res.filter((x) => x === 'false_alarm').length : 0, unanswered: adjudicated ? res.filter((x) => x === 'unanswered').length : 0,
        o7: defs.filter((d) => d.class === 'O7').length, archive_lines_dropped: arm === 'archive' ? p.dropped.archive.length : null,
        ref_chars: machine ? flat(refNorm).replace(/ /g, '').length : null,
        cer_raw: machine ? r4(cerChars(p.ref.text.split('\n'), rawText)) : null, cer_norm: machine ? r4(cerChars(refLines, p.norm[arm])) : null, cer_conv: machine ? r4(cerLines(refNorm, p.norm[arm], 'latin')) : null,
        ref_numbers: nm?.ref_numbers ?? null, numbers_wrong: nm?.wrong ?? null });
    }
  }
  const pick = (f) => ['archive', 'ours', 'human'].map((arm) => { const rs = rows.filter((r) => r.arm === arm && f(r)); return rs.length ? { arm, ...armSummary(rs) } : null; }).filter(Boolean);
  const three = (r) => r.set === 'A' || r.set === 'B';
  const out = { generated_at: new Date().toISOString(), issue: 7941, inbox_note: 'Derek 2026-11-02 13:48Z: one normaliser, same wrapping, cuts by Archive engine and century, benchmark books flagged, random Archive stratum',
    normaliser: `three-way.mjs normalise (furniture by source, then NFC, long s to s, line-end hyphens joined, whitespace collapsed, re-wrapped to ${WRAP} columns); normalizeForScript v${NORMALIZE_FOR_SCRIPT_VERSION} for cer_conv`,
    align_rule: `set A/B: best F1 of typed-reference words over every Archive leaf >= ${ALIGN_F1}; set C: the image's own leaf (moved only for a clear drift)`,
    judge: 'route-judge-6740 judgePrompt via confidence-7866 judgeAbsolute; claude -p --model opus (subscription); blind to source, normalised text',
    adjudicators: 'opus + sonnet via claude -p, ADJ3_PROMPT, all arms of a page in one call, unlabelled; confirmed = both say the page prints something else',
    rates: 'flagged/confirmed per 1,000 words of the typed reference (set C: of our normalised read); CER = order-free character error of the typed reference inside the text (raw: no normaliser; norm: normalised, case and punctuation kept; conv: normalised + normalizeForScript folds); numbers = typed-page digit runs missing from the text',
    three_way: { pages: new Set(rows.filter(three).map((r) => r.uid)).size, by_lang: {} }, cuts: {}, archive_vs_ours_random: null };
  for (const lang of ['ALL', 'English', 'Latin', 'German']) { const a = pick((r) => three(r) && (lang === 'ALL' || r.lang === lang)); if (a.length) out.three_way.by_lang[lang] = a; }
  const cut = (name, keyf, base = three) => { const ks = [...new Set(rows.filter(base).map(keyf))].sort(); out.cuts[name] = Object.fromEntries(ks.map((k) => [String(k), pick((r) => base(r) && keyf(r) === k)])); };
  cut('set', (r) => r.set); cut('century', (r) => r.century); cut('archive_engine', (r) => r.ia_engine); cut('in_benchmark', (r) => (r.in_benchmark ? 'in a reference set' : 'not in any reference set'));
  cut('language_x_engine', (r) => `${r.lang} / ${r.ia_engine}`);
  cut('ours_read', (r) => (r.ours_empty ? 'our stored read is empty' : 'our stored read has text'));
  out.archive_vs_ours_random = { pages: new Set(rows.filter((r) => r.set === 'C').map((r) => r.uid)).size, all: pick((r) => r.set === 'C'), by_engine: {}, by_century: {} };
  for (const k of [...new Set(rows.filter((r) => r.set === 'C').map((r) => r.ia_engine))].sort()) out.archive_vs_ours_random.by_engine[k] = pick((r) => r.set === 'C' && r.ia_engine === k);
  for (const k of [...new Set(rows.filter((r) => r.set === 'C').map((r) => r.century))].sort()) out.archive_vs_ours_random.by_century[k] = pick((r) => r.set === 'C' && r.century === k);
  // paired: per page, archive minus ours (the same pages, the same judge)
  const paired = (base) => { const ids = [...new Set(rows.filter(base).map((r) => r.uid))]; let aw = 0, ow = 0, tie = 0;
    for (const id of ids) { const a = rows.find((r) => r.uid === id && r.arm === 'archive'), o = rows.find((r) => r.uid === id && r.arm === 'ours'); if (!a || !o) continue; const da = a.flagged / a.words, dob = o.flagged / o.words; if (da < dob) aw++; else if (dob < da) ow++; else tie++; }
    return { pages: ids.length, archive_fewer_flags: aw, ours_fewer_flags: ow, tied: tie }; };
  out.paired_flags = { three_way: paired(three), random: paired((r) => r.set === 'C') };
  const al = jsonl(F.align);
  out.alignment = { set_A_pages: al.length, by_status: al.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {}),
    by_lang: Object.fromEntries(['English', 'Latin', 'German'].map((l) => [l, al.filter((r) => r.lang === l).reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {})])),
    aligned_at_image_leaf: `${al.filter((r) => r.status === 'aligned' && r.leaf === r.photo_leaf).length}/${al.filter((r) => r.status === 'aligned').length}`,
    not_aligned_best_is_image_leaf: `${al.filter((r) => r.status === 'not_aligned' && r.leaf === r.photo_leaf).length}/${al.filter((r) => r.status === 'not_aligned').length}`,
    not_aligned_by_engine: al.filter((r) => r.status === 'not_aligned').reduce((m, r) => ((m[r.ia_engine] = (m[r.ia_engine] || 0) + 1), m), {}),
    set_B: fs.existsSync(F.added) ? { pages: J(F.added).added.length, skipped: J(F.added).skipped.reduce((m, s) => ((m[s.why] = (m[s.why] || 0) + 1), m), {}), same_leaf_as_5124: J(F.added).added.filter((r) => r.leaf === r.leaf_5124).length } : null,
    set_C: fs.existsSync(F.random) ? { pages: J(F.random).drawn.length, frame_books: J(F.random).frame_books, skipped: J(F.random).skipped.reduce((m, s) => ((m[s.why] = (m[s.why] || 0) + 1), m), {}), leaf_moved_from_image_leaf: J(F.random).drawn.filter((r) => r.leaf !== r.photo_leaf).length } : null };
  out.archive_furniture_lines_dropped = rows.filter((r) => r.arm === 'archive').reduce((s, r) => s + r.archive_lines_dropped, 0);
  out.opus_calls = opusSpent(); out.sonnet_calls = jsonl(F.adj).filter((r) => r.judge === 'sonnet').length;
  fs.writeFileSync(path.join(RESULTS, 'three-way.json'), JSON.stringify(out, null, 1) + '\n');
  fs.writeFileSync(path.join(RESULTS, 'three-way-pages.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(RESULTS, 'three-way-align.jsonl'), al.map((r) => JSON.stringify(r)).join('\n') + '\n');
  if (fs.existsSync(F.added)) fs.writeFileSync(path.join(RESULTS, 'three-way-added.json'), JSON.stringify(J(F.added), null, 1) + '\n');
  if (fs.existsSync(F.random)) fs.writeFileSync(path.join(RESULTS, 'three-way-random.json'), JSON.stringify(J(F.random), null, 1) + '\n');
  fs.writeFileSync(path.join(RESULTS, 'three-way-verdicts.jsonl'), [...V.values()].map((r) => JSON.stringify({ id: r.id, arm: r.arm, uid: r.uid, model: r.model, prompt_sha: r.prompt_sha, text_sha: r.text_sha, at: r.at,
    accept: r.verdict.accept, fidelity: r.verdict.fidelity, defects: (r.verdict.defects || []).map((x) => ({ class: x.class, severity: x.severity })) })).join('\n') + '\n');
  fs.writeFileSync(path.join(RESULTS, 'three-way-adjudications.jsonl'), adj.map((r) => JSON.stringify({ uid: r.uid, judge: r.judge, model: r.model, points: r.points.map(({ page_prints, ...x }) => x) })).join('\n') + '\n');
  const line = (lab, o) => console.log(lab.padEnd(34), o.arm.padEnd(8), `n=${o.n_pages}`, `flag/1k ${o.flagged_per_1k} ${JSON.stringify(o.flagged_per_1k_ci95)}`, `conf/1k ${o.confirmed_per_1k} (${o.adjudicated_pages}p)`, `cer raw/norm/conv ${o.cer_raw ?? '-'}/${o.cer_norm ?? '-'}/${o.cer_conv ?? '-'}`, `num ${o.number_error_rate ?? '-'}`, `bad ${o.judge_bad}`);
  for (const [k, xs] of Object.entries(out.three_way.by_lang)) for (const o of xs) line(`3-way ${k}`, o);
  for (const [c, m] of Object.entries(out.cuts)) for (const [k, xs] of Object.entries(m)) for (const o of xs) line(`${c}: ${k}`.slice(0, 34), o);
  for (const o of out.archive_vs_ours_random.all) line('random C', o);
  console.log(JSON.stringify(out.paired_flags), 'opus', out.opus_calls, 'sonnet', out.sonnet_calls);
}

const stages = { ia, align, added, random, judge, adjudicate, score, show };
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[process.argv[2]]();
}
