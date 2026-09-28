#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/en-ocr-reference-5124.mjs (#5124 — both engines against a Wikisource /
 * Gutenberg reference; its `misread_candidates` found 10 Archive number misreads but only on pages
 * a volunteer proofread, and its truth is a transcription, not the image); scripts/_tmp-digit-check
 * (#5186, untracked — numbers in the lite read absent from the Archive read, Gemini as the
 * reference, so it cannot say WHO is right); scripts/eval/ia-ocr-delivered-quality.mjs (#4780 —
 * agreement, no truth). None of them adjudicates a disputed number on the page image, and none
 * measures the case both engines miss identically. Reused from 5124: the normaliser, the word
 * alignment, `leafIndex`, `loadLeaves`/`iaCovariates`, the store row shapes and `stageOcr`.
 * Reused from scripts/lib: ia-ocr-meta `iaFetch`, dehyphenate, page-image-url, identity-fields.
 *
 * numbers-5224 — which OCR engine reads printed NUMBERS correctly (#5224; feeds #5124, #5186).
 *
 * THE DECISION IT FEEDS. The routing rule proposed on #5124 ("Archive text only for 1880–1930
 * pages with no numbers") and the digits gate proposed on #5186 both assume the Archive misreads
 * printed numbers and lite does not. That rests on 10 Archive misreads and lite 0/750. A reader
 * quoting a date from a county history is harmed by a SILENT 1836→1886; this instrument measures,
 * per engine, how often a printed 2–4-digit number comes out as a different number, with the
 * page image as the truth.
 *
 * THE TRUTH. Numbers the two engines AGREE on are counted correct (and a fully adjudicated
 * subset measures how often that assumption is wrong — the shared blind spot). Numbers they
 * DISAGREE on are cropped from the page image at the Archive `_djvu.xml` WORD box and read
 * BLIND by a model eye (Sonnet, `adjudicated_by: model-eye`): the reader sees a red box and is
 * asked what digits are printed, never what either engine said. 10% are queued for a human.
 *
 * PAGES. (a) The 2,282 #5186 county-history pages: Archive text in `page_revisions`
 * (reason `reocr_realtime`, source `ia_djvu`), lite in `pages.ocr` (realtime run 2026-09-26).
 * 4 books → 4 clusters; 25 pages per book are adjudicated. (b) Breadth: one number-dense
 * interior page per book from ~130 English IA books 1800–1930 (seeded, decade quotas),
 * lite read into the EVAL STORE, never `pages`.
 *
 * STAGES (fetch/crop on Hetzner — archive.org and Atlas are flaky from the laptop):
 *   --stage=pairs      join page_revisions × pages for the #5186 books; leaf located; image fetched (free)
 *   --stage=draw       breadth: sample books, pick the number-densest interior Archive leaf, our page + image (free)
 *   --stage=ocr        lite read of breadth pages → eval store (PAID, --max-cost)
 *   --stage=locate     breadth: which Archive leaf is the image? lite-text neighbour search (free)
 *   --stage=align      numeric-token alignment Archive ↔ lite on every page → numbers.jsonl (free)
 *   --stage=select     adjudication plan: 25 pages/book (a) + all (b) + 30-page full subset
 *   --stage=crops      blind crops + 8-up sheets from djvu WORD boxes (free)
 *   --stage=merge      collect adjudications/*.jsonl → adjudicated.jsonl, human queue
 *   --stage=score      verdicts, per-engine rates with book-cluster CIs, confusion table → store scores
 *   --stage=fixture    pinned fixture set benchmark/numbers-en-5224.json + crops
 *   --stage=report     report.md
 *   --stage=regress --texts=<dir>   score any engine's page texts (<slug>.txt) against the fixture
 * Nothing here writes to `pages`, `books` or any store a production lane reads.
 *
 * usage-ok: one-off hand-run eval, ≈130 pages of lite realtime (≈$0.40), hard stop at --max-cost 3,
 * never scheduled. Recorded in scripts/eval/EXPERIMENTS.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../lib/mongo.mjs';
import { dehyphenateLineBreaks } from '../lib/dehyphenate.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { editionYear } from '../lib/identity-fields.mjs';
import { iaFetch } from '../lib/ia-ocr-meta.mjs';
import { OCR_MODEL_LITE } from '../lib/ocr-routing.mjs';
import { runGemini, fetchImage } from './lib/runners.mjs';
import { getProductionOcrPrompt } from './lib/production-prompt.mjs';
import { bootstrapRatioCI, resetSeed } from './lib/paired-stats.mjs';

const argEq = (k, d) => { const a = process.argv.find((x) => x.startsWith(`${k}=`)); return a ? a.slice(k.length + 1) : d; };
const STAGE = argEq('--stage', 'report');
const SEED = +argEq('--seed', 5224);
const MAX_COST = +argEq('--max-cost', 3);
const CONCURRENCY = +argEq('--concurrency', 4);
const CACHE = argEq('--cache', '/root/sl-ia-cache');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = argEq('--out', path.join(HERE, 'results', 'numbers-5224'));
const IMG = argEq('--img', path.join(OUT, 'img'));            // page images (not committed)
const STORE = argEq('--store', path.join(HERE, 'store'));    // on Hetzner: a scratch dir, merged into the repo store by hand
const RUN_ID = argEq('--run-id', 'numbers-5224-2026-09');
const MONTH = '2026-09';
const BREADTH_BOOKS = +argEq('--breadth-books', 130);
const PER_BOOK_A = +argEq('--per-book', 25);
const SUBSET_N = +argEq('--subset', 30);
const PER_SHEET = 8;
const TABLE_SHARE = 0.35;
const CAP_DISAGREE = +argEq('--cap', 20);   // adjudicated disagreements per page; the rest are represented by weight
fs.mkdirSync(OUT, { recursive: true });
const F = (n) => path.join(OUT, n);
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r4 = (x) => (x == null || Number.isNaN(x) ? null : +x.toFixed(4));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---------- seeded RNG (mulberry32), as in the 5124 script ----------
let seed = SEED >>> 0;
const rand = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- the #5186 books (Archive text snapshotted by realtime-ocr.mjs before the lite overwrite) ----------
const PAIR_BOOKS = {
  '6aa4c8a388a2920a45a88592': { short: 'Deyo Barnstable 1890', ia: 'historyofbarnsta00deyo_0', year: 1890 },
  '6aa4c8b488a2920a45a88e2e': { short: 'Wakeley Omaha 1917', ia: 'omahagatecitydou02wake', year: 1917 },
  '6aa4c8bb88a2920a45a8921b': { short: 'NH Notables 1919', ia: 'onethousandnewha00metc', year: 1919 },
  '6aa4c89788a2920a45a883eb': { short: 'Book of Clevelanders 1914', ia: 'bookofclevelande01burr', year: 1914 },
};
const LITE_RUN_A = 'realtime-ocr 2026-09-26 (#5186; Hetzner run PuoR8LUpHxvcLR3OilFMY + two laptop starts)';
const UA = 'SourceLibrary-Numbers-Eval/1.0 (https://sourcelibrary.org; team@sourcelibrary.org) node-fetch';

// ---------- IA djvu XML: leaves WITH word boxes (5124's leafTexts drops the coords) ----------
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
/** → [{width, height, lines: [[{t, l, r, top, bot}]]}] per OBJECT; coords="left,bottom,right,top" (DjVu) */
function leafBoxes(xml) {
  const out = [];
  for (const o of xml.split(/<OBJECT\b/).slice(1)) {
    const head = o.slice(0, o.indexOf('>'));
    const width = +(head.match(/width="(\d+)"/) || [])[1] || null, height = +(head.match(/height="(\d+)"/) || [])[1] || null;
    const lines = [];
    for (const l of o.split(/<LINE\b/).slice(1)) {
      const ws = [];
      for (const m of l.matchAll(/<WORD coords="(\d+),(\d+),(\d+),(\d+)(?:,\d+)?"[^>]*>([\s\S]*?)<\/WORD>/g)) {
        const t = decode(m[5]).trim(); if (!t) continue;
        ws.push({ t, l: +m[1], bot: +m[2], r: +m[3], top: +m[4] });
      }
      if (ws.length) lines.push(ws);
    }
    out.push({ width, height, lines });
  }
  return out;
}
const leafText = (leaf) => leaf.lines.map((ws) => ws.map((w) => w.t).join(' ')).join('\n');
async function loadXml(iaId, xmlName) {
  const x = path.join(CACHE, `${iaId}_djvu.xml`);
  if (fs.existsSync(x)) return { xml: fs.readFileSync(x, 'utf8'), from: 'cache-xml' };
  let res = null;
  for (let a = 0; a < 3 && !res?.ok; a++) {
    if (a) await sleep(10000);
    res = await fetch(`https://archive.org/download/${iaId}/${encodeURIComponent(xmlName || `${iaId}_djvu.xml`)}`, { headers: { 'User-Agent': UA }, redirect: 'follow' }).catch(() => null);
  }
  if (!res?.ok) return null;
  const xml = await res.text();
  fs.writeFileSync(x, xml);   // the shared cache — same file name the ingester uses
  return { xml, from: 'download' };
}
const XMLS = new Map();
async function leavesOf(iaId, xmlName) {
  if (XMLS.has(iaId)) return XMLS.get(iaId);
  const x = await loadXml(iaId, xmlName);
  const v = x ? { leaves: leafBoxes(x.xml), from: x.from } : null;
  XMLS.set(iaId, v); return v;
}
async function iaCovariates(iaId) {
  const res = await iaFetch(`https://archive.org/metadata/${iaId}`);
  if (!res.ok) return null;
  const j = await res.json(); const m = j?.metadata || {};
  const xmlFiles = (j?.files || []).filter((f) => /_djvu\.xml$/.test(f.name || ''));
  const xmlFile = xmlFiles.find((f) => f.name === `${iaId}_djvu.xml`) || xmlFiles[0];
  const scanner = [].concat(m.scanner || []).join('; ') || null;
  return {
    ocr: [].concat(m.ocr || []).join('; ') || null, ocr_module_version: m.ocr_module_version || null, ocr_converted: m.ocr_converted || null,
    ocr_date: xmlFile?.mtime ? new Date(+xmlFile.mtime * 1000).toISOString().slice(0, 10) : null,
    scanner, scanner_class: /goog/i.test(`${scanner || ''} ${iaId}`) || /google/i.test(`${m.contributor || ''} ${m.sponsor || ''}`) ? 'google' : scanner ? 'ia-native' : 'unknown',
    scandate: m.scandate ? String(m.scandate).slice(0, 8) : null, contributor: [].concat(m.contributor || []).join('; ') || null,
    xml_name: xmlFile?.name || null, n_xml: xmlFiles.length,
  };
}
const leafIndex = (p) => { const m = String(p.photo || p.archived_photo || '').match(/\/page\/n(\d+)\//); return m ? +m[1] : (p.page_number || 1) - 1; };
const PAGE_PROJ = { id: 1, page_number: 1, photo: 1, archived_photo: 1, display_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, hidden: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1, 'ocr.prompt_version': 1, 'ocr.updated_at': 1 };

// ---------- text normalisation (5124's, with one deliberate change) ----------
// For NUMBERS the printed page number and running head are numbers a reader may quote, and the
// Archive transcribes them in place; lite files them in <page-num>/<header>/<footer> at the END.
// Their content is therefore KEPT and moved to the front, where the Archive prints them, instead
// of being dropped as 5124 did (its reference excluded them). Tags whose content is not on the
// page (<vocab>, <summary>, <warning>…) are still dropped with their content. `->…<-` first, as
// 5124 learned (a generic tag strip eats a page from `<-` to the next `>`).
function normalise(s) {
  const front = [], notes = [];
  s = String(s || '')
    .replace(/<(page-num|header|footer)\b[^<>]*>([\s\S]*?)<\/\1>/gi, (_, __, x) => { front.push(x); return ' '; })
    .replace(/<note\b[^<>]*>([\s\S]*?)<\/note>/gi, (_, x) => { notes.push(x); return ' '; });
  s = front.join(' ') + '\n' + s + (notes.length ? '\n' + notes.join('\n') : '');
  return s
    .replace(/^->\s*|\s*<-$/gm, '').replace(/->|<-/g, ' ')
    .replace(/<(warning|meta|image-desc|figure|scan-quality|language|page-type|columns|detected-images|vocab|summary|keywords|script|catchword|signature)\b[^<>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '').replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1').replace(/^-{3,}$/gm, '').replace(/^>\s*/gm, '').replace(/\|/g, ' ')
    .normalize('NFKC').toLowerCase().replace(/ſ/g, 's').replace(/[’‘ʼ`´]/g, "'").replace(/[“”„]/g, '"').replace(/[‐‑‒–—―]/g, '-')
    .replace(/(\p{L})-\s+(\p{L})/gu, '$1$2')
    .replace(/\s+/g, ' ').trim();
}
const words = (s) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const isNum = (w) => /^\d{2,4}$/.test(w);
const NUM_RULE = 'v1: numeric token = /^\\d{2,4}$/ after NFKC + split on non-alphanumerics (1,538 → 1 + 538; 188% → 188)';
const bagDice = (a, b) => { if (!a.length || !b.length) return 0; const c = new Map(); for (const t of a) c.set(t, (c.get(t) || 0) + 1); let m = 0; for (const t of b) { const n = c.get(t); if (n) { m++; c.set(t, n - 1); } } return (2 * m) / (a.length + b.length); };

/** word-level edit alignment with backtrace; cap raised from 5124's 6e6 (directory pages run 3,000 words) */
function alignWords(ref, hyp) {
  const n = ref.length, m = hyp.length;
  if (n * m > 3e7) return null;
  const D = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i++) D[i][0] = i; for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  const ops = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) { ops.push({ op: ref[i - 1] === hyp[j - 1] ? '=' : 's', r: ref[i - 1], h: hyp[j - 1], ri: i - 1, hi: j - 1 }); i--; j--; }
    else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { ops.push({ op: 'd', r: ref[i - 1], ri: i - 1 }); i--; }
    else { ops.push({ op: 'i', h: hyp[j - 1], hi: j - 1 }); j--; }
  }
  return ops.reverse();
}

/**
 * The Archive token stream is built from the XML WORDs (not the dehyphenated leaf text), so every
 * Archive token carries its word box. A WORD may yield several tokens ("1,538,342" → three).
 */
function archiveTokens(leaf) {
  const toks = [];
  leaf.lines.forEach((ws, li) => ws.forEach((w, wi) => { for (const t of words(normalise(w.t))) toks.push({ t, li, wi }); }));
  return toks;
}

/**
 * Number events on one page. Archive tokens A (with boxes) vs lite tokens L.
 *   agree        the same numeric token at an aligned position (or rescued order-free with shared context)
 *   sub          aligned position, tokens differ, at least one numeric (1836↔1886, 551↔ssi, 105↔io)
 *   archive_only numeric token in A with no counterpart in L
 *   lite_only    numeric token in L with no counterpart in A
 * Each event carries the Archive word (for the crop) or the nearest matched Archive anchors.
 */
function numberEvents(A, L) {
  const at = A.map((x) => x.t), lt = L;
  const ops = alignWords(at, lt);
  if (!ops) return { events: null, reason: 'too-long' };
  const ctxA = (i) => at.slice(Math.max(0, i - 3), i + 4), ctxL = (j) => lt.slice(Math.max(0, j - 3), j + 4);
  const anchorsFor = (hi) => {   // nearest matched Archive tokens before/after a lite position
    let before = null, after = null;
    for (const o of ops) { if (o.op !== '=') continue; if (o.hi < hi) before = o.ri; else if (o.hi > hi && after == null) { after = o.ri; break; } }
    return { before, after };
  };
  const events = [];
  // 1. positional agreement; every other numeric token goes to an unmatched pool with its aligned partner
  const unA = [], unL = [];
  for (const o of ops) {
    if (o.op === '=' && isNum(o.r)) { events.push({ kind: 'agree', a: o.r, l: o.h, ai: o.ri, hi: o.hi, ctx: ctxA(o.ri).join(' ') }); continue; }
    if ((o.op === 's' || o.op === 'd') && isNum(o.r)) unA.push({ ai: o.ri, a: o.r, partner: o.op === 's' ? { hi: o.hi, l: o.h } : null, ctx: ctxA(o.ri) });
    if ((o.op === 's' || o.op === 'i') && isNum(o.h)) unL.push({ hi: o.hi, l: o.h, partner: o.op === 's' ? { ai: o.ri, a: o.r } : null, ctx: ctxL(o.hi) });
  }
  // 2. Order-free rescue by VALUE + CONTEXT: a reading-order difference (columns, the page number
  // filed at the end, a table read row- vs column-wise, a decimal split "26.2" → "26" "2") leaves the
  // same number unmatched on both sides. Equal value + ≥ 1 shared context word → agree(rescued).
  const share = (c1, c2, v) => { const st = new Set(c1); return c2.some((w) => w !== v && st.has(w)); };
  for (const x of unA) { const m = unL.find((y) => !y.rescued && y.l === x.a && share(x.ctx, y.ctx, x.a)); if (m) { x.rescued = m; m.rescued = x; events.push({ kind: 'agree', rescued: true, a: x.a, l: m.l, ai: x.ai, hi: m.hi, ctx: x.ctx.join(' ') }); } }
  // 3. What is left: a numeric pair still aligned to each other is a SUB (the misread candidate);
  // an Archive number whose partner is a word or nothing is ARCHIVE_ONLY (the crop is its box; the
  // partner word is kept as `l` for the record); a lite number likewise is LITE_ONLY (anchored).
  const usedL = new Set();
  for (const x of unA) {
    if (x.rescued) continue;
    const p = x.partner && isNum(x.partner.l) ? unL.find((y) => y.hi === x.partner.hi && !y.rescued) : null;
    if (p) { usedL.add(p); events.push({ kind: 'sub', a: x.a, l: p.l, ai: x.ai, hi: p.hi, ctx: x.ctx.join(' ') }); }
    else events.push({ kind: 'archive_only', a: x.a, l: x.partner ? x.partner.l : null, ai: x.ai, hi: null, ctx: x.ctx.join(' ') });
  }
  for (const y of unL) { if (y.rescued || usedL.has(y)) continue; events.push({ kind: 'lite_only', a: y.partner ? y.partner.a : null, l: y.l, ai: null, hi: y.hi, ctx: y.ctx.join(' '), anchors: anchorsFor(y.hi) }); }
  events.sort((p, q) => (p.ai ?? p.hi) - (q.ai ?? q.hi));
  return { events, n_ops: ops.length, wer_words: ops.filter((o) => o.op !== '=').length / Math.max(1, at.length) };
}

// ============================ stages ============================

/** PAIRS — the #5186 books: Archive text (page_revisions) × lite text (pages.ocr) × leaf × image */
async function stagePairs(db) {
  const done = new Map(readJsonl(F('pairs.jsonl')).map((r) => [r.slug, r]));
  fs.mkdirSync(IMG, { recursive: true }); fs.mkdirSync(F('texts'), { recursive: true });
  for (const [bookId, meta] of Object.entries(PAIR_BOOKS)) {
    const cov = await iaCovariates(meta.ia);
    const X = await leavesOf(meta.ia, cov?.xml_name); if (!X) { console.log(`${meta.short}: no djvu xml`); continue; }
    const revs = await db.collection('page_revisions').find({ book_id: bookId, reason: 'reocr_realtime', source: 'ia_djvu', field: 'ocr' }, { projection: { page_id: 1, data: 1, model: 1, created_at: 1 } }).toArray();
    const pages = new Map((await db.collection('pages').find({ book_id: bookId }, { projection: PAGE_PROJ }).toArray()).map((p) => [p.id, p]));
    console.log(`${meta.short}: ${revs.length} revisions, ${pages.size} pages, ${X.leaves.length} leaves (${X.from})`);
    let n = 0;
    for (const rev of revs) {
      const p = pages.get(rev.page_id); if (!p || p.ocr?.model !== OCR_MODEL_LITE) continue;
      const slug = `a-${bookId.slice(-8)}-p${p.page_number}`;   // the four ids share their first 10 chars — key by the tail
      if (done.has(slug) && done.get(slug).image_bytes) continue;
      const row = { slug, set: 'a', book_id: bookId, book: meta.short, ia: meta.ia, year: meta.year, page_id: p.id, page_number: p.page_number, leaf_hint: leafIndex(p), archive_model: rev.model || null, ia_meta: cov, lite_prompt_version: p.ocr.prompt_version || null, lite_updated_at: p.ocr.updated_at || null };
      // locate the leaf the ingester wrote: best bag-of-words match around the page's leaf index (should be ≈ 1)
      const rt = words(normalise(rev.data)); let best = { k: null, bow: 0 };
      for (let k = Math.max(0, row.leaf_hint - 3); k <= Math.min(X.leaves.length - 1, row.leaf_hint + 3); k++) { const s = bagDice(rt, words(normalise(leafText(X.leaves[k])))); if (s > best.bow) best = { k, bow: s }; }
      row.leaf = best.k; row.leaf_bow = r4(best.bow); row.leaf_offset = best.k == null ? null : best.k - row.leaf_hint;
      // image ↔ leaf cross-check: the lite text read OUR image; if a neighbouring leaf matches it better, the pair is shifted
      const lw = words(normalise(p.ocr.data)); let bestL = { k: null, bow: 0 };
      for (let k = Math.max(0, row.leaf_hint - 3); k <= Math.min(X.leaves.length - 1, row.leaf_hint + 3); k++) { const s = bagDice(lw, words(normalise(leafText(X.leaves[k])))); if (s > bestL.bow) bestL = { k, bow: s }; }
      row.image_leaf = bestL.k; row.image_leaf_bow = r4(bestL.bow); row.engines_bow = r4(best.k == null ? 0 : bagDice(lw, words(normalise(leafText(X.leaves[best.k])))));
      row.leaf_check = best.k == null ? 'no-leaf' : bestL.k === best.k ? 'ok' : bestL.bow - row.engines_bow > 0.15 ? 'shifted' : 'ok-weak';
      row.image_url = getPageSource(p) || null; row.split_from_spread = !!p.split_from_spread;
      fs.writeFileSync(F(`texts/${slug}.ia-djvu.txt`), rev.data); fs.writeFileSync(F(`texts/${slug}.lite.txt`), p.ocr.data);
      done.set(slug, row); n++;
      if (n % 200 === 0) { writeJsonl(F('pairs.jsonl'), [...done.values()]); console.log(`  ${n}…`); }
    }
    writeJsonl(F('pairs.jsonl'), [...done.values()]);
  }
  console.log(`pairs: ${done.size}`);
}

/** IMAGES — fetch the page image for every row of a set file (pairs after select, breadth at draw) */
async function fetchImages(rows) {
  fs.mkdirSync(IMG, { recursive: true });
  let n = 0;
  const one = async (r) => {
    const f = path.join(IMG, `${r.slug}.jpg`);
    if (fs.existsSync(f) && fs.statSync(f).size > 1000) { r.image_bytes = fs.statSync(f).size; return; }
    if (!r.image_url) { r.image_error = 'no-image-url'; return; }
    try { const buf = await fetchImage(r.image_url, 90000); fs.writeFileSync(f, buf); r.image_bytes = buf.length; delete r.image_error; }
    catch (e) { r.image_error = String(e.message || e).slice(0, 120); }
    if (++n % 25 === 0) console.log(`  images ${n}`);
  };
  for (let i = 0; i < rows.length; i += CONCURRENCY) await Promise.all(rows.slice(i, i + CONCURRENCY).map(one));
}

/** DRAW — breadth: English IA books 1800–1930, decade quotas, the number-densest interior Archive leaf */
async function stageDraw(db) {
  const prior = new Map(readJsonl(F('breadth.jsonl')).map((r) => [r.book_id, r]));
  const books = await db.collection('books').find(
    { language: { $in: ['en', 'English', 'english'] }, $or: [{ ia_identifier: { $exists: true, $ne: null } }, { 'image_source.provider': 'ia' }], pages_count: { $gt: 30 }, id: { $nin: Object.keys(PAIR_BOOKS) } },
    { projection: { id: 1, title: 1, author: 1, published: 1, year: 1, ia_identifier: 1, 'image_source.identifier': 1, pages_count: 1, visible: 1, subjects: 1 } }).toArray();
  const inRange = books.map((b) => ({ ...b, y: editionYear(b) })).filter((b) => b.y >= 1800 && b.y <= 1930);
  const byDecade = new Map(); for (const b of shuffle(inRange)) { const d = Math.floor(b.y / 10) * 10; if (!byDecade.has(d)) byDecade.set(d, []); byDecade.get(d).push(b); }
  console.log(`pool: ${inRange.length} English IA books 1800–1930 in ${byDecade.size} decades`);
  // round-robin over decades so the sample spreads across the period; a decade with few books gives what it has
  const order = []; const decades = [...byDecade.keys()].sort(); let more = true;
  for (let i = 0; more; i++) { more = false; for (const d of decades) { const b = byDecade.get(d)[i]; if (b) { order.push(b); more = true; } } }
  let accepted = [...prior.values()].filter((r) => r.image_bytes).length;
  const P = db.collection('pages');
  for (const b of order) {
    if (accepted >= BREADTH_BOOKS) break;
    if (prior.has(b.id)) continue;
    const ia = b.ia_identifier || b.image_source?.identifier;
    const row = { slug: `b-${b.id.slice(-8)}`, set: 'b', book_id: b.id, ia, title: String(b.title || '').slice(0, 90), author: b.author || null, year: b.y, decade: Math.floor(b.y / 10) * 10, visible: !!b.visible };
    try {
      const cov = await iaCovariates(ia); row.ia_meta = cov;
      if (!cov?.xml_name) { row.skipped = 'no-ia-djvu-xml'; throw Object.assign(new Error('skip'), { skip: true }); }
      const X = await leavesOf(ia, cov.xml_name); if (!X) { row.skipped = 'xml-download-failed'; throw Object.assign(new Error('skip'), { skip: true }); }
      row.ia_leaves = X.leaves.length; row.xml_from = X.from;
      const pages = await P.find({ book_id: b.id }, { projection: PAGE_PROJ }).toArray();
      const byLeaf = new Map(); for (const p of pages) if (!p.split_from_spread && !p.hidden) byLeaf.set(leafIndex(p), p);
      // interior leaves (15%, 95%] of the SCAN, ranked by numeric-token count in the Archive text
      const lo = Math.floor(X.leaves.length * 0.15), hi = Math.floor(X.leaves.length * 0.95);
      const cands = [];
      for (let k = lo + 1; k <= hi; k++) { const p = byLeaf.get(k); if (!p || !getPageSource(p)) continue; const toks = words(normalise(leafText(X.leaves[k]))); const nn = toks.filter(isNum).length; if (nn >= 8 && toks.length >= 60) cands.push({ k, nn, ntok: toks.length }); }
      if (!cands.length) { row.skipped = 'no-number-dense-leaf'; throw Object.assign(new Error('skip'), { skip: true }); }
      // the densest, but not a pure table: cap the numeric share at 60% so a page of nothing but figures does not dominate
      cands.sort((x, y) => y.nn - x.nn);
      const pick = cands.find((c) => c.nn / c.ntok <= 0.6) || cands[0];
      const p = byLeaf.get(pick.k);
      Object.assign(row, { leaf: pick.k, leaf_hint: pick.k, leaf_num_tokens: pick.nn, leaf_tokens: pick.ntok, page_id: p.id, page_number: p.page_number, image_url: getPageSource(p), our_ocr_source: p.ocr?.source || null, our_ocr_model: p.ocr?.model || null, archive_model: cov.ocr_module_version ? `ia-ocr/${cov.ocr_module_version}` : cov.ocr || cov.ocr_converted || null });
      fs.mkdirSync(F('texts'), { recursive: true });
      fs.writeFileSync(F(`texts/${row.slug}.ia-djvu.txt`), leafText(X.leaves[pick.k]) + '\n');
      await fetchImages([row]);
      if (row.image_bytes) accepted++;
      console.log(`  ${row.slug} ${row.year} leaf ${pick.k}/${X.leaves.length} nums ${pick.nn} p${p.page_number} ${row.archive_model} ${row.image_bytes ? 'img' : row.image_error} [${accepted}]`);
    } catch (e) {
      if (!e.skip) { row.error = String(e.message || e).slice(0, 200); console.log(`  ${row.slug} ERROR ${row.error}`); }
      else console.log(`  ${row.slug} SKIP ${row.skipped}`);
    }
    prior.set(b.id, row);
    writeJsonl(F('breadth.jsonl'), [...prior.values()]);
    XMLS.clear();   // 30 MB of XML per book — do not hold them all
  }
  console.log(`breadth accepted: ${accepted}`);
}

/** OCR — lite read of breadth page images into the eval store (5124's stageOcr, run_id changed) */
async function stageOcr(db) {
  const prompt = await getProductionOcrPrompt(db);
  const promptHash = sha(prompt.text);
  const rows = readJsonl(F('breadth.jsonl')).filter((r) => r.image_bytes && !r.skipped);
  const outDir = path.join(STORE, 'outputs', OCR_MODEL_LITE); fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${MONTH}.jsonl`);
  const prior = readJsonl(outFile).filter((o) => o.run_id === RUN_ID);
  const have = new Set(prior.filter((o) => o.outcome === 'text' || (o.outcome === 'refusal' && o.attempt === 2)).map((o) => o.slug));
  let spent = prior.reduce((s, o) => s + (o.cost_usd || 0), 0);
  console.log(`prompt v${prompt.version} ${promptHash}; ${rows.length} pages, ${have.size} done, $${spent.toFixed(4)} spent`);
  const queue = rows.filter((r) => !have.has(r.slug));
  const one = async (r) => {
    const attempts = prior.filter((o) => o.slug === r.slug && o.outcome !== 'error').length;
    for (let attempt = attempts + 1; attempt <= 2; attempt++) {
      if (spent >= MAX_COST) { console.log('max cost reached'); return; }
      const buf = fs.readFileSync(path.join(IMG, `${r.slug}.jpg`));
      const row = { run_id: RUN_ID, slug: r.slug, engine: 'gemini-lite-realtime', model: OCR_MODEL_LITE, engine_version: OCR_MODEL_LITE, prompt_id: `ocr-default-v${prompt.version}`, prompt_hash: promptHash,
        params: { thinking: 'budget-0', temperature: 0, max_tokens: 8000, batch: false, context_given: null }, attempt, at: new Date().toISOString(), by: 'numbers-5224', issue: 5224 };
      try {
        const res = await runGemini(OCR_MODEL_LITE, buf, prompt.text, { temperature: 0, maxTokens: 8000, endpoint: 'eval/numbers-5224', usageType: 'ocr' });
        spent += res.costUsd || 0;
        const fr = res.finishReason;
        row.finish_reason = fr; row.cost_usd = +(res.costUsd || 0).toFixed(6); row.latency_ms = res.durationMs; row.chars = (res.text || '').length;
        row.outcome = /RECITATION|PROHIBITED|SAFETY|BLOCKLIST/.test(fr) ? 'refusal' : fr === 'MAX_TOKENS' ? 'truncated' : !res.text?.trim() ? 'empty' : 'text';
        if (row.outcome === 'text' || row.outcome === 'truncated') {
          const tp = F(`texts/${r.slug}.lite.txt`); fs.writeFileSync(tp, res.text);
          row.text_path = path.relative(HERE, tp); row.text_hash = sha(res.text);
        }
      } catch (e) { row.outcome = 'error'; row.error = String(e.message || e).slice(0, 200); }
      fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
      console.log(`  ${r.slug} #${attempt} ${row.outcome} ${row.finish_reason || row.error || ''} $${spent.toFixed(4)}`);
      if (row.outcome !== 'refusal') return;
    }
  };
  for (let i = 0; i < queue.length; i += CONCURRENCY) await Promise.all(queue.slice(i, i + CONCURRENCY).map(one));
  console.log(`spent $${spent.toFixed(4)}`);
}

/** LOCATE — breadth: the Archive leaf that IS the image, by the lite text (neighbour search, as 5124's rescue) */
async function stageLocate() {
  const rows = readJsonl(F('breadth.jsonl'));
  const outs = readJsonl(path.join(STORE, 'outputs', OCR_MODEL_LITE, `${MONTH}.jsonl`)).filter((o) => o.run_id === RUN_ID);
  for (const r of rows) {
    if (!r.image_bytes) continue;
    const mine = outs.filter((o) => o.slug === r.slug);
    const fin = mine.find((o) => o.outcome === 'text' || o.outcome === 'truncated');
    r.lite_outcome = fin ? fin.outcome : (mine.slice(-1)[0]?.outcome || 'not-run');
    r.lite_refused_first = mine.some((o) => o.outcome === 'refusal' && o.attempt === 1);
    if (!fin) { r.leaf_check = 'no-lite'; continue; }
    const X = await leavesOf(r.ia, r.ia_meta?.xml_name); if (!X) { r.leaf_check = 'no-xml'; continue; }
    const lw = words(normalise(fs.readFileSync(path.join(HERE, fin.text_path), 'utf8')));
    let best = { k: null, bow: 0 };
    for (let k = Math.max(0, r.leaf_hint - 3); k <= Math.min(X.leaves.length - 1, r.leaf_hint + 3); k++) { const s = bagDice(lw, words(normalise(leafText(X.leaves[k])))); if (s > best.bow) best = { k, bow: s }; }
    r.image_leaf = best.k; r.image_leaf_bow = r4(best.bow); r.engines_bow = r4(bagDice(lw, words(normalise(leafText(X.leaves[r.leaf_hint])))));
    if (best.k == null || best.bow < 0.4) r.leaf_check = 'no-leaf-match';
    else if (best.k !== r.leaf_hint) { r.leaf_check = 'shifted'; r.leaf = best.k; fs.writeFileSync(F(`texts/${r.slug}.ia-djvu.txt`), leafText(X.leaves[best.k]) + '\n'); }
    else r.leaf_check = 'ok';
    XMLS.clear();
  }
  writeJsonl(F('breadth.jsonl'), rows);
  const c = {}; for (const r of rows) c[r.leaf_check || r.skipped || 'other'] = (c[r.leaf_check || r.skipped || 'other'] || 0) + 1;
  console.log('locate:', JSON.stringify(c));
}

const allPages = () => [...readJsonl(F('pairs.jsonl')), ...readJsonl(F('breadth.jsonl')).filter((r) => r.image_bytes && r.lite_outcome === 'text')];
const liteTextOf = (r) => fs.readFileSync(F(`texts/${r.slug}.lite.txt`), 'utf8');

/** ALIGN — number events on every page (free; the engine-disagreement rate over all 2,282 pairs is a by-product) */
async function stageAlign() {
  const rows = allPages().filter((r) => r.leaf != null && ['ok', 'ok-weak', 'shifted'].includes(r.leaf_check));
  const events = [], pages = [];
  let i = 0;
  for (const r of rows) {
    const X = await leavesOf(r.ia, r.ia_meta?.xml_name); if (!X) continue;
    const A = archiveTokens(X.leaves[r.leaf]); const L = words(normalise(liteTextOf(r)));
    const res = numberEvents(A, L);
    if (!res.events) { pages.push({ slug: r.slug, set: r.set, book_id: r.book_id, skipped: res.reason, a_tokens: A.length, l_tokens: L.length }); continue; }
    const k = { agree: 0, sub: 0, archive_only: 0, lite_only: 0, rescued: 0 };
    for (const e of res.events) { k[e.kind]++; if (e.rescued) k.rescued++; }
    pages.push({ slug: r.slug, set: r.set, book_id: r.book_id, book: r.book || r.title, year: r.year, archive_model: r.archive_model, leaf_check: r.leaf_check, a_tokens: A.length, l_tokens: L.length, word_disagreement: r4(res.wer_words), ...k, numbers_archive: k.agree + k.sub + k.archive_only, numbers_lite: k.agree + k.sub + k.lite_only });
    res.events.forEach((e, n) => events.push({ id: `${r.slug}#${n}`, slug: r.slug, set: r.set, book_id: r.book_id, ...e }));
    if (++i % 200 === 0) console.log(`  aligned ${i}/${rows.length}`);
    if (r.set === 'b') XMLS.clear();
  }
  writeJsonl(F('align-pages.jsonl'), pages); writeJsonl(F('numbers.jsonl'), events);
  const t = { agree: 0, sub: 0, archive_only: 0, lite_only: 0 }; for (const e of events) t[e.kind]++;
  console.log(`pages ${pages.length}, events`, JSON.stringify(t));
}

/** SELECT — which pages are adjudicated, and the fully adjudicated subset */
function stageSelect() {
  const all = readJsonl(F('align-pages.jsonl')).filter((p) => !p.skipped);
  // A TABLE page (numbers > 35% of the Archive's tokens: hygrometer readings, price lists, census
  // columns) is a different payload from the years and page references this instrument is for, and
  // one such page carried 796 disagreements — mostly decimals split by the tokeniser. Excluded
  // from adjudication; counted in the report.
  const isTable = (p) => p.numbers_archive / Math.max(1, p.a_tokens) > TABLE_SHARE;
  const pages = all.filter((p) => !isTable(p));
  console.log(`table pages excluded: ${all.filter(isTable).length} of ${all.length}`);
  const plan = [];
  for (const bookId of Object.keys(PAIR_BOOKS)) {
    const mine = shuffle(pages.filter((p) => p.set === 'a' && p.book_id === bookId && (p.numbers_archive + p.numbers_lite) > 0));
    mine.slice(0, PER_BOOK_A).forEach((p, i) => plan.push({ slug: p.slug, set: 'a', book_id: bookId, rank: i }));
  }
  for (const p of pages.filter((p) => p.set === 'b')) plan.push({ slug: p.slug, set: 'b', book_id: p.book_id, rank: 0 });
  // full subset: SUBSET_N pages, half from (a) (spread over the 4 books), half from (b)
  const half = Math.floor(SUBSET_N / 2);
  const agreeOf = new Map(pages.map((p) => [p.slug, p.agree]));
  const subsetOk = (p) => agreeOf.get(p.slug) >= 5 && agreeOf.get(p.slug) <= 60;   // enough numbers to measure, few enough to read them all
  const subA = []; for (let i = 0; subA.length < half; i++) { const bookId = Object.keys(PAIR_BOOKS)[i % 4]; const c = plan.find((p) => p.set === 'a' && p.book_id === bookId && p.rank === Math.floor(i / 4) && !p.full && subsetOk(p)); if (c) { c.full = true; subA.push(c); } if (i > 200) break; }
  shuffle(plan.filter((p) => p.set === 'b' && subsetOk(p))).slice(0, SUBSET_N - subA.length).forEach((p) => { p.full = true; });
  writeJsonl(F('plan.jsonl'), plan);
  console.log(`plan: ${plan.length} pages (${plan.filter((p) => p.set === 'a').length} a, ${plan.filter((p) => p.set === 'b').length} b), full subset ${plan.filter((p) => p.full).length}`);
}

/**
 * CROPS — one blind crop per adjudicated number event, then 8-up sheets.
 *   box     the Archive WORD that carries the token (sub, archive_only, and agree in the full subset)
 *   between the two Archive anchor words around a lite_only number (no Archive box exists)
 * The crop is the window ±450 px around the target on its line, ±0.7 line-heights vertically,
 * scaled to 1200 px wide (up or down), the target/anchors in red. Nothing on the sheet says what
 * either engine read.
 */
async function stageCrops() {
  const sharp = (await import('sharp')).default;
  const plan = new Map(readJsonl(F('plan.jsonl')).map((p) => [p.slug, p]));
  const rows = new Map(allPages().map((r) => [r.slug, r]));
  const events = readJsonl(F('numbers.jsonl')).filter((e) => plan.has(e.slug) && (e.kind !== 'agree' || plan.get(e.slug).full));
  // page images for the (a) plan pages were not fetched at pairs time (2,282 images is 2 GB) — fetch now
  const need = [...plan.values()].map((p) => rows.get(p.slug)).filter(Boolean);
  await fetchImages(need);
  writeJsonl(F('pairs.jsonl'), readJsonl(F('pairs.jsonl')).map((r) => rows.get(r.slug) || r));
  fs.mkdirSync(F('crops'), { recursive: true }); fs.mkdirSync(F('sheets'), { recursive: true });
  const crops = []; const bySlug = new Map();
  for (const e of events) { if (!bySlug.has(e.slug)) bySlug.set(e.slug, []); bySlug.get(e.slug).push(e); }
  // Per-page cap: a directory page can carry 100+ disagreements; CAP_DISAGREE of them are read
  // (seeded draw) and each carries weight = total / read. Unread ones are written with weight 0.
  for (const [slug, evs] of bySlug) {
    const dis = evs.filter((e) => e.kind !== 'agree');
    if (dis.length > CAP_DISAGREE) { const keep = new Set(shuffle(dis).slice(0, CAP_DISAGREE)); for (const e of dis) { if (keep.has(e)) e.weight = +(dis.length / CAP_DISAGREE).toFixed(4); else { e.weight = 0; e.capped = true; } } }
    else for (const e of dis) e.weight = 1;
    for (const e of evs) if (e.kind === 'agree') e.weight = 1;
    bySlug.set(slug, evs.filter((e) => !e.capped)); for (const e of evs) if (e.capped) crops.push({ ...e, crop: null, crop_error: 'capped' });
  }
  let n = 0;
  for (const [slug, evs] of bySlug) {
    const r = rows.get(slug); if (!r?.image_bytes) { for (const e of evs) crops.push({ ...e, crop: null, crop_error: 'no-image' }); continue; }
    const X = await leavesOf(r.ia, r.ia_meta?.xml_name); const leaf = X?.leaves[r.leaf]; if (!leaf) { for (const e of evs) crops.push({ ...e, crop: null, crop_error: 'no-leaf' }); continue; }
    const A = archiveTokens(leaf);
    const img = sharp(path.join(IMG, `${slug}.jpg`)); const md = await img.metadata();
    const sx = md.width / (leaf.width || md.width), sy = md.height / (leaf.height || md.height);
    const wordOf = (ai) => { const t = A[ai]; return t ? { ...leaf.lines[t.li][t.wi], li: t.li } : null; };
    for (const e of evs) {
      let target = null, anchors = [], type = 'box';
      if (e.ai != null) target = wordOf(e.ai);
      else { type = 'between'; const b = e.anchors?.before != null ? wordOf(e.anchors.before) : null, a = e.anchors?.after != null ? wordOf(e.anchors.after) : null; anchors = [b, a].filter(Boolean); if (!anchors.length) { crops.push({ ...e, crop: null, crop_error: 'no-anchor' }); continue; } target = anchors[0]; }
      if (!target) { crops.push({ ...e, crop: null, crop_error: 'no-word' }); continue; }
      const marks = type === 'box' ? [target] : anchors;
      const h = Math.max(20, target.bot - target.top);
      // a 'between' window is wider and taller: a lite-only number is often the page number or a
      // running head the Archive dropped, printed on the line ABOVE the first anchor
      const padX = type === 'box' ? 450 : 650, padY = type === 'box' ? 0.7 : 1.8;
      const left = Math.max(0, Math.min(...marks.map((m) => m.l)) - padX), right = Math.min(leaf.width || md.width / sx, Math.max(...marks.map((m) => m.r)) + padX);
      const top = Math.max(0, Math.min(...marks.map((m) => m.top)) - padY * h), bot = Math.min(leaf.height || md.height / sy, Math.max(...marks.map((m) => m.bot)) + padY * h);
      const ex = { left: Math.round(left * sx), top: Math.round(top * sy), width: Math.max(8, Math.round((right - left) * sx)), height: Math.max(8, Math.round((bot - top) * sy)) };
      if (ex.left + ex.width > md.width) ex.width = md.width - ex.left; if (ex.top + ex.height > md.height) ex.height = md.height - ex.top;
      const rects = marks.map((m) => `<rect x="${(m.l - left) * sx - 4}" y="${(m.top - top) * sy - 4}" width="${(m.r - m.l) * sx + 8}" height="${(m.bot - m.top) * sy + 8}" fill="none" stroke="#e00" stroke-width="5"/>`).join('');
      const id = `${slug}#${e.id.split('#')[1]}`; const file = `crops/${id.replace('#', '_')}.jpg`;
      try {
        // the overlay must match the EXTRACTED size exactly (167 crops failed on a 1-px mismatch)
        const base = await sharp(path.join(IMG, `${slug}.jpg`)).extract(ex).toBuffer(); const bm = await sharp(base).metadata();
        const svg = Buffer.from(`<svg width="${bm.width}" height="${bm.height}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`);
        // two passes: sharp applies resize BEFORE composite whatever the call order, so a crop wider than
        // 1200 px was shrunk under a full-size overlay and rejected (159 crops, all wide 'between' windows)
        const marked = await sharp(base).composite([{ input: svg, top: 0, left: 0 }]).toBuffer();
        await sharp(marked).resize({ width: 1200 }).jpeg({ quality: 82 }).toFile(F(file));
        crops.push({ ...e, type, crop: file, box: type === 'box' ? { l: target.l, top: target.top, r: target.r, bot: target.bot } : null, anchors_box: type === 'between' ? anchors.map((m) => ({ l: m.l, top: m.top, r: m.r, bot: m.bot })) : undefined, leaf_wh: [leaf.width, leaf.height], img_wh: [md.width, md.height], line_h: Math.round(h) });
      } catch (err) { crops.push({ ...e, crop: null, crop_error: String(err.message || err).slice(0, 100) }); }
    }
    if (++n % 20 === 0) console.log(`  cropped ${n}/${bySlug.size} pages, ${crops.length} crops`);
    if (r.set === 'b') XMLS.clear();
  }
  // sheets: shuffled so a sheet mixes books and kinds (no run of one page's numbers to prime the reader)
  const ok = shuffle(crops.filter((c) => c.crop));
  const sheets = [];
  for (let i = 0; i < ok.length; i += PER_SHEET) {
    const group = ok.slice(i, i + PER_SHEET); const sheetId = `sheet-${String(sheets.length + 1).padStart(3, '0')}`;
    const parts = []; let y = 0; const W = 1200 + 90;
    for (let j = 0; j < group.length; j++) {
      const c = group[j]; const buf = await sharp(F(c.crop)).toBuffer(); const m = await sharp(buf).metadata();
      const label = Buffer.from(`<svg width="90" height="${m.height}" xmlns="http://www.w3.org/2000/svg"><rect width="90" height="${m.height}" fill="#ffe"/><text x="45" y="${Math.min(m.height - 10, 48)}" font-size="40" font-weight="bold" font-family="DejaVu Sans, sans-serif" text-anchor="middle" fill="#000">${j + 1}</text></svg>`);
      parts.push({ input: label, top: y, left: 0 }, { input: buf, top: y, left: 90 });
      c.sheet = sheetId; c.pos = j + 1; c.question = c.type === 'box' ? 'digits in the red box' : 'a number printed between the two red boxes, or next to a lone box';
      y += m.height + 14;
    }
    const canvas = sharp({ create: { width: W, height: Math.max(1, y - 14), channels: 3, background: '#222' } });
    await canvas.composite(parts).jpeg({ quality: 82 }).toFile(F(`sheets/${sheetId}.jpg`));
    sheets.push({ sheet: sheetId, items: group.map((c) => ({ pos: c.pos, id: c.id, type: c.type })) });
  }
  writeJsonl(F('crops.jsonl'), crops); writeJsonl(F('sheets.jsonl'), sheets);
  const k = {}; for (const c of crops) { const key = c.crop ? `${c.kind}/${c.type}` : `fail/${c.crop_error}`; k[key] = (k[key] || 0) + 1; }
  console.log(`crops`, JSON.stringify(k), `sheets ${sheets.length}`);
}

/** MERGE — adjudications/*.jsonl ({sheet, pos, printed, figures, confidence, note}) → adjudicated.jsonl + human queue */
function stageMerge() {
  const crops = readJsonl(F('crops.jsonl'));   // capped and failed rows travel through with printed: null
  const byKey = new Map(crops.filter((c) => c.crop).map((c) => [`${c.sheet}/${c.pos}`, c]));
  const adj = new Map();
  const dir = F('adjudications'); if (!fs.existsSync(dir)) { console.log('no adjudications/ yet'); return; }
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    for (const a of readJsonl(path.join(dir, f))) {
      const key = `${a.sheet}/${a.pos}`; if (!byKey.has(key)) continue;
      adj.set(key, { ...a, by: a.by || 'model-eye', file: f });
    }
  }
  const digitsOf = (s) => { s = String(s ?? '').trim().toLowerCase(); if (!s || /^(none|no number|unreadable|\?|-)$/.test(s)) return s === 'unreadable' || s === '?' ? 'unreadable' : 'none'; const d = s.replace(/[^\d]/g, ''); return d || 'none'; };
  const out = crops.map((c) => { const a = adj.get(`${c.sheet}/${c.pos}`); return a ? { ...c, printed: digitsOf(a.printed), printed_raw: a.printed, figures: a.figures || null, confidence: a.confidence || null, note: a.note || null, adjudicated_by: a.by, adjudicated_at: a.at || null } : { ...c, printed: null }; });
  writeJsonl(F('adjudicated.jsonl'), out);
  resetSeed(SEED);
  const done = out.filter((c) => c.printed != null);
  console.log(`crop rows ${crops.length}: cut ${crops.filter((c) => c.crop).length}, capped ${crops.filter((c) => c.crop_error === 'capped').length}, failed ${crops.filter((c) => !c.crop && c.crop_error !== 'capped').length}`);
  const human = shuffle(done).slice(0, Math.ceil(done.length * 0.1)).map((c) => ({ id: c.id, sheet: c.sheet, pos: c.pos, crop: c.crop, question: c.question, model_printed: c.printed, kind: c.kind, archive: c.a, lite: c.l, human_printed: null }));
  if (!fs.existsSync(F('human-queue.jsonl'))) writeJsonl(F('human-queue.jsonl'), human);
  console.log(`adjudicated ${done.length}/${crops.length}; human queue ${human.length} (10%)`);
}

// ---------- verdicts ----------
/** what the engine's token was for this event, on each side */
const sideTok = (c, side) => (side === 'archive' ? c.a : c.l);
/**
 * Per event × engine: right | wrong | spurious | unjudged
 *   printed digits d; engine token t (null = engine has no number here)
 *   t === d → right; t != null && d === 'none' → spurious; t == null && d has digits → wrong (dropped);
 *   t != null && d digits && t !== d → wrong (misread); unreadable → unjudged
 */
function verdict(c, side) {
  const d = c.printed, t = sideTok(c, side);
  if (d == null || d === 'unreadable') return 'unjudged';
  const tn = t != null && isNum(t) ? t : null;
  const letterDigits = t != null && tn == null && /^[\dilIoOsSzZgGbB]+$/.test(t);   // 'loi' for 101, 'i3' for 13, 'ssi' for 551
  if (d === 'none') return tn == null ? 'right-none' : 'spurious';
  if (tn == null) return letterDigits ? 'wrong-misread' : 'wrong-dropped';
  return tn === d ? 'right' : 'wrong-misread';
}
function confusionClass(t, d) {
  if (t == null) return 'dropped';
  if (d === 'none') return 'spurious';
  if (t === d) return null;
  if (!isNum(t)) return /^[\dilIoOsSzZgGbB]+$/.test(t) ? 'letters-for-digits' : 'dropped';
  if (t.length === d.length) { const pairs = []; for (let i = 0; i < t.length; i++) if (t[i] !== d[i]) pairs.push(`${d[i]}→${t[i]}`); return pairs.length === 1 ? `digit ${pairs[0]}` : `digits ${pairs.join(',')}`; }
  if (t.length < d.length) return 'digit dropped';
  return 'digit inserted';
}

/** SCORE — rates, CIs, confusion, blind spot; scores store */
function stageScore() {
  const adj = readJsonl(F('adjudicated.jsonl'));
  const plan = new Map(readJsonl(F('plan.jsonl')).map((p) => [p.slug, p]));
  const pagesAll = readJsonl(F('align-pages.jsonl'));
  const rows = new Map(allPages().map((r) => [r.slug, r]));
  const events = readJsonl(F('numbers.jsonl')).filter((e) => plan.has(e.slug));
  const adjById = new Map(adj.map((c) => [c.id, c]));
  // per page × engine tallies over the adjudicated pages
  const perPage = new Map();
  const tally = (slug, side, key, n = 1) => { if (!n) return; if (!perPage.has(slug)) perPage.set(slug, { archive: {}, lite: {} }); const t = perPage.get(slug)[side]; t[key] = (t[key] || 0) + n; };
  const conf = { archive: {}, lite: {} }, blind = { agreed_judged: 0, both_wrong_same: 0, both_wrong_diff: 0, agreed_unreadable: 0, agreed_none: 0 };
  const examples = { archive: [], lite: [] };
  for (const e of events) {
    const c = adjById.get(e.id);
    if (c && c.crop_error === 'capped') continue;   // represented by the weight of a read sibling on the same page
    const w = c?.weight ?? 1;
    if (e.kind === 'agree') {
      if (c && c.printed != null && plan.get(e.slug).full) {
        if (c.printed === 'unreadable') { blind.agreed_unreadable++; tally(e.slug, 'archive', 'unjudged'); tally(e.slug, 'lite', 'unjudged'); continue; }
        blind.agreed_judged++;
        if (c.printed === 'none') { blind.agreed_none++; tally(e.slug, 'archive', 'spurious'); tally(e.slug, 'lite', 'spurious'); continue; }
        if (c.printed === e.a) { tally(e.slug, 'archive', 'right'); tally(e.slug, 'lite', 'right'); }
        else { blind.both_wrong_same++; tally(e.slug, 'archive', 'wrong-misread'); tally(e.slug, 'lite', 'wrong-misread'); for (const s of ['archive', 'lite']) { const k = confusionClass(e.a, c.printed); conf[s][k] = (conf[s][k] || 0) + 1; examples[s].push({ id: e.id, engine: e.a, printed: c.printed, kind: 'agree', ctx: e.ctx }); } }
      } else { tally(e.slug, 'archive', 'agreed'); tally(e.slug, 'lite', 'agreed'); }   // counted correct (blind spot measured above)
      continue;
    }
    if (!c || c.printed == null) { tally(e.slug, 'archive', 'unjudged', w); tally(e.slug, 'lite', 'unjudged', w); continue; }
    for (const side of ['archive', 'lite']) {
      const v = verdict(c, side); tally(e.slug, side, v, w);
      if (v.startsWith('wrong') || v === 'spurious') { const k = confusionClass(sideTok(c, side), c.printed); conf[side][k] = +((conf[side][k] || 0) + w).toFixed(2); if (examples[side].length < 400) examples[side].push({ id: e.id, engine: sideTok(c, side), printed: c.printed, kind: e.kind, ctx: e.ctx, crop: c.crop }); }
    }
  }
  // per page rows → store scores; per book sums → cluster CIs
  const scores = [], perBook = new Map();
  for (const [slug, t] of perPage) {
    const r = rows.get(slug); const p = plan.get(slug);
    for (const side of ['archive', 'lite']) {
      const x = t[side]; const right = (x.right || 0) + (x.agreed || 0);   // 'right-none' (no number printed, engine printed none) is not a printed number
      const wrong = (x['wrong-misread'] || 0) + (x['wrong-dropped'] || 0), spurious = x.spurious || 0, unjudged = x.unjudged || 0;
      const printed = right + wrong;   // printed numbers with a verdict (agreed ones counted as printed+right)
      const metric = { numbers_printed: r4(printed), wrong: r4(wrong), misread: x['wrong-misread'] || 0, dropped: x['wrong-dropped'] || 0, spurious, unjudged, agreed_counted_correct: x.agreed || 0, digit_err: printed ? r4(wrong / printed) : null };
      scores.push({ slug, book_id: r.book_id, set: r.set, engine: side === 'archive' ? 'ia-djvu' : 'gemini-lite-realtime', run_id: side === 'archive' ? `ia-djvu:${r.archive_model || r.ia_meta?.ocr_date || 'unknown'}` : (r.set === 'a' ? LITE_RUN_A : RUN_ID), measure: 'accuracy', against: { reference_id: `image-adjudication:numbers-5224 (model-eye, blind crops)` }, full_subset: !!p.full, scorer: SCORER, scorer_version: 1, normaliser_version: 'numbers-normalise@1', number_rule: NUM_RULE, leaf_check: r.leaf_check, abstain: false, metric, at: new Date().toISOString() });
      const key = `${side}|${r.book_id}`; if (!perBook.has(key)) perBook.set(key, { side, book_id: r.book_id, set: r.set, book: r.book || r.title, year: r.year, decade: r.decade ?? Math.floor((r.year || 0) / 10) * 10, archive_model: r.archive_model, pages: 0, printed: 0, wrong: 0, misread: 0, dropped: 0, spurious: 0, unjudged: 0 });
      const b = perBook.get(key); b.pages++; b.printed += printed; b.wrong += wrong; b.misread += metric.misread; b.dropped += metric.dropped; b.spurious += spurious; b.unjudged += unjudged;
    }
  }
  const dir = path.join(STORE, 'scores', SCORER); fs.mkdirSync(dir, { recursive: true });
  writeJsonl(path.join(dir, `${MONTH}.jsonl`), scores);
  // rates with book-cluster bootstrap
  resetSeed(SEED);
  const rate = (books, num = 'wrong') => bootstrapRatioCI(books.map((b) => b[num]), books.map((b) => b.printed));
  const summary = { sets: {}, by_archive_model: {}, by_decade: {}, blind, confusion: conf };
  const groups = { all: () => true, a: (b) => b.set === 'a', b: (b) => b.set === 'b' };
  for (const [g, f] of Object.entries(groups)) for (const side of ['archive', 'lite']) {
    const bs = [...perBook.values()].filter((b) => b.side === side && f(b)); if (!bs.length) continue;
    const r = rate(bs), rm = rate(bs, 'misread'), rd = rate(bs, 'dropped');
    summary.sets[`${g}|${side}`] = { books: bs.length, pages: bs.reduce((s, b) => s + b.pages, 0), printed: r.denom, wrong: bs.reduce((s, b) => s + b.wrong, 0), rate: r4(r.rate), ci: r.ci?.map(r4), misread_rate: r4(rm.rate), misread_ci: rm.ci?.map(r4), dropped_rate: r4(rd.rate), spurious: bs.reduce((s, b) => s + b.spurious, 0), unjudged: bs.reduce((s, b) => s + b.unjudged, 0) };
  }
  const byKey = (keyOf, target) => { const m = new Map(); for (const b of perBook.values()) { const k = `${keyOf(b)}|${b.side}`; if (!m.has(k)) m.set(k, []); m.get(k).push(b); } for (const [k, bs] of m) { const r = rate(bs); target[k] = { books: bs.length, pages: bs.reduce((s, b) => s + b.pages, 0), printed: r.denom, wrong: bs.reduce((s, b) => s + b.wrong, 0), rate: r4(r.rate), ci: r.ci?.map(r4) }; } };
  byKey((b) => b.archive_model || 'unknown', summary.by_archive_model);
  byKey((b) => `${b.decade}s`, summary.by_decade);
  // shared blind spot
  summary.blind.rate_both_wrong_identically = blind.agreed_judged ? r4(blind.both_wrong_same / blind.agreed_judged) : null;
  // engine disagreement over ALL pages (free, agreement not truth)
  const dis = {}; for (const p of pagesAll.filter((p) => !p.skipped)) { const k = `${p.set}|${p.archive_model || '?'}`; dis[k] = dis[k] || { pages: 0, agree: 0, sub: 0, archive_only: 0, lite_only: 0 }; const d = dis[k]; d.pages++; d.agree += p.agree; d.sub += p.sub; d.archive_only += p.archive_only; d.lite_only += p.lite_only; }
  summary.disagreement_all_pages = dis;
  summary.per_book = [...perBook.values()];
  fs.writeFileSync(F('summary.json'), JSON.stringify(summary, null, 1));
  fs.writeFileSync(F('error-examples.json'), JSON.stringify(examples, null, 1));
  console.log(JSON.stringify(summary.sets, null, 1)); console.log('blind', JSON.stringify(blind));
}
const SCORER = 'numbers-scorer@1';

/** FIXTURE — every adjudicated number, with its crop, as a pinned set any engine can be scored on */
function stageFixture() {
  const adj = readJsonl(F('adjudicated.jsonl')).filter((c) => c.crop && c.printed != null && c.printed !== 'unreadable');
  const rows = new Map(allPages().map((r) => [r.slug, r]));
  const human = new Map(readJsonl(F('human-queue.jsonl')).filter((h) => h.human_printed != null).map((h) => [h.id, h]));
  const dir = path.join(HERE, 'benchmark', 'numbers-crops'); fs.mkdirSync(dir, { recursive: true });
  const items = adj.map((c) => {
    const r = rows.get(c.slug); const h = human.get(c.id);
    const file = `numbers-crops/${c.crop.split('/')[1]}`; fs.copyFileSync(F(c.crop), path.join(HERE, 'benchmark', file));
    return { id: c.id, set: c.set, book_id: c.book_id, page_id: r?.page_id, page_number: r?.page_number, ia: r?.ia, leaf: r?.leaf, year: r?.year, archive_model: r?.archive_model,
      kind: c.kind, question: c.question, box: c.box || null, anchors_box: c.anchors_box || null, leaf_wh: c.leaf_wh, ctx: c.ctx,
      printed: h ? String(h.human_printed).replace(/[^\d]/g, '') || 'none' : c.printed, figures: c.figures, adjudicated_by: h ? 'human' : c.adjudicated_by, model_eye_printed: c.printed, confidence: c.confidence, note: c.note,
      engines: { 'ia-djvu': c.a, 'gemini-lite-realtime': c.l }, crop: file };
  });
  const reg = { id: 'numbers-en-5224', issue: 5224, created: new Date().toISOString().slice(0, 10), measure: 'accuracy', unit: 'one printed 2–4-digit number (or the place an engine put one)', number_rule: NUM_RULE,
    truth: 'page image, read blind at the red box by a model eye (Sonnet); human spot-check where adjudicated_by=human', reserve: false, licence: 'public-domain scans (Internet Archive); crops are of pre-1931 US/UK print',
    books: [...new Set(items.map((i) => i.book_id))].length, pages: [...new Set(items.map((i) => i.page_id))].length, items: items.length, sets: { a: '#5186 county histories (Archive text vs lite realtime 2026-09-26)', b: 'breadth: one number-dense interior page per English IA book 1800–1930' },
    how_to_score: 'numbers-5224.mjs --stage=regress --texts=<dir of <slug>.txt>: for each fixture item, does the engine text contain `printed` in the item\'s context window?',
    items };
  fs.writeFileSync(path.join(HERE, 'benchmark', 'numbers-en-5224.json'), JSON.stringify(reg, null, 1));
  console.log(`fixture: ${items.length} numbers, ${reg.pages} pages, ${reg.books} books`);
}

/** REGRESS — score any engine's page texts against the fixture (context-window containment) */
function stageRegress() {
  const dir = argEq('--texts', null); if (!dir) throw new Error('--texts=<dir of <slug>.txt>');
  const reg = JSON.parse(fs.readFileSync(path.join(HERE, 'benchmark', 'numbers-en-5224.json'), 'utf8'));
  const cache = new Map(); const textOf = (slug) => { if (!cache.has(slug)) { const f = path.join(dir, `${slug}.txt`); cache.set(slug, fs.existsSync(f) ? words(normalise(fs.readFileSync(f, 'utf8'))) : null); } return cache.get(slug); };
  let right = 0, wrong = 0, missing = 0, spurious = 0, skip = 0;
  for (const it of reg.items) {
    const slug = it.id.split('#')[0]; const toks = textOf(slug); if (!toks) { skip++; continue; }
    const ctx = it.ctx.split(' ').filter((w) => !isNum(w) && w.length > 2);
    // a window is "the context" when it shares ≥ 2 context words; the number is right if the window holds `printed`
    let found = false, any = false;
    for (let i = 0; i < toks.length; i++) { const win = toks.slice(Math.max(0, i - 4), i + 5); const share = ctx.filter((w) => win.includes(w)).length; if (share >= 2) { any = true; if (it.printed !== 'none' && win.includes(it.printed)) { found = true; break; } if (it.printed === 'none' && !win.some(isNum)) { found = true; break; } } }
    if (!any) { missing++; continue; }
    if (found) right++; else if (it.printed === 'none') spurious++; else wrong++;
  }
  console.log(JSON.stringify({ items: reg.items.length, right, wrong, spurious, context_not_found: missing, no_text: skip, digit_err: r4(wrong / Math.max(1, right + wrong)) }));
}

/** REPORT — markdown */
function stageReport() {
  const S = JSON.parse(fs.readFileSync(F('summary.json'), 'utf8'));
  const pct = (x, d = 2) => (x == null ? '–' : `${(x * 100).toFixed(d)}%`), ci = (c, d = 2) => (c ? `[${(c[0] * 100).toFixed(d)}, ${(c[1] * 100).toFixed(d)}]` : '');
  const adj = readJsonl(F('adjudicated.jsonl')); const crops = readJsonl(F('crops.jsonl'));
  const L = [];
  L.push(`# Numbers test (#5224) — which engine reads printed numbers correctly\n`);
  L.push(`Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/eval/numbers-5224.mjs\`. **measure: accuracy** (truth = the page image, read blind at the number). ${NUM_RULE}.\n`);
  L.push(`## Per-engine error on printed numbers (book-cluster bootstrap 95% CI)\n`);
  L.push(`| set | engine | books | pages | numbers printed | wrong (misread + dropped) | **error rate** | misread only | dropped only | spurious | unreadable crops |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
  const label = { all: 'ALL', a: '(a) #5186 county histories', b: '(b) breadth English IA 1800–1930' };
  for (const g of ['all', 'a', 'b']) for (const side of ['archive', 'lite']) { const s = S.sets[`${g}|${side}`]; if (!s) continue; L.push(`| ${label[g]} | ${side === 'archive' ? 'ia-djvu (Archive)' : 'gemini-lite-realtime'} | ${s.books} | ${s.pages} | ${s.printed} | ${s.wrong} | **${pct(s.rate)}** ${ci(s.ci)} | ${pct(s.misread_rate)} ${ci(s.misread_ci)} | ${pct(s.dropped_rate)} | ${s.spurious} | ${s.unjudged} |`); }
  L.push(`\nNumbers the engines agree on are counted correct; the shared-blind-spot line below says how often that is wrong. "Spurious" = the engine printed a number where the image has none (not in the rate; a separate count). Grades by referenced books: (a) 4 books = exploratory as a cluster; (b) ${S.sets['b|archive']?.books || 0} books.\n`);
  L.push(`## Shared blind spot (both engines wrong identically) — fully adjudicated subset\n`);
  L.push(`| agreed numbers read on the image | both right | both wrong, same number | image has no number | unreadable | **P(both wrong \\| agree)** |\n|---|---|---|---|---|---|`);
  L.push(`| ${S.blind.agreed_judged} | ${S.blind.agreed_judged - S.blind.both_wrong_same - S.blind.agreed_none} | ${S.blind.both_wrong_same} | ${S.blind.agreed_none} | ${S.blind.agreed_unreadable} | **${pct(S.blind.rate_both_wrong_identically)}** |\n`);
  L.push(`## Confusion table (adjudicated errors, by engine)\n`);
  const keys = [...new Set([...Object.keys(S.confusion.archive), ...Object.keys(S.confusion.lite)])].sort((x, y) => ((S.confusion.archive[y] || 0) + (S.confusion.lite[y] || 0)) - ((S.confusion.archive[x] || 0) + (S.confusion.lite[x] || 0)));
  L.push(`| class | ia-djvu | gemini-lite |\n|---|---|---|`); for (const k of keys) L.push(`| ${k} | ${S.confusion.archive[k] || 0} | ${S.confusion.lite[k] || 0} |`);
  const digitPairs = (side) => { const m = {}; for (const [k, v] of Object.entries(S.confusion[side])) { if (!k.startsWith('digit')) continue; for (const p of k.replace(/^digits? /, '').split(',')) m[p] = (m[p] || 0) + v; } return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  L.push(`\nDigit pairs (printed→read): Archive ${digitPairs('archive').map(([k, v]) => `${k} ×${v}`).join(', ') || 'none'}; lite ${digitPairs('lite').map(([k, v]) => `${k} ×${v}`).join(', ') || 'none'}.\n`);
  L.push(`## By Archive OCR module version\n\n| version | engine | books | pages | numbers | wrong | rate [CI] |\n|---|---|---|---|---|---|---|`);
  for (const [k, v] of Object.entries(S.by_archive_model).sort()) { const [ver, side] = k.split('|'); L.push(`| ${ver} | ${side} | ${v.books} | ${v.pages} | ${v.printed} | ${v.wrong} | ${pct(v.rate)} ${ci(v.ci)} |`); }
  L.push(`\n## By decade of the edition\n\n| decade | engine | books | pages | numbers | wrong | rate [CI] |\n|---|---|---|---|---|---|---|`);
  for (const [k, v] of Object.entries(S.by_decade).sort()) { const [dec, side] = k.split('|'); L.push(`| ${dec} | ${side} | ${v.books} | ${v.pages} | ${v.printed} | ${v.wrong} | ${pct(v.rate)} ${ci(v.ci)} |`); }
  L.push(`\n## Engine disagreement on EVERY page (agreement, not truth — context for the rates above)\n\n| set | Archive module | pages | numbers agreed | substituted | Archive only | lite only | numbers in dispute |\n|---|---|---|---|---|---|---|---|`);
  for (const [k, d] of Object.entries(S.disagreement_all_pages).sort()) { const [set, ver] = k.split('|'); const tot = d.agree + d.sub + d.archive_only + d.lite_only; L.push(`| ${set} | ${ver} | ${d.pages} | ${d.agree} | ${d.sub} | ${d.archive_only} | ${d.lite_only} | ${pct(tot ? (d.sub + d.archive_only + d.lite_only) / tot : null, 1)} |`); }
  L.push(`\n## Per book\n\n| book | year | Archive module | engine | pages | numbers | wrong | rate |\n|---|---|---|---|---|---|---|---|`);
  for (const b of S.per_book.sort((x, y) => (x.set + x.book_id + x.side).localeCompare(y.set + y.book_id + y.side))) L.push(`| ${b.book} | ${b.year} | ${b.archive_model || '?'} | ${b.side} | ${b.pages} | ${b.printed} | ${b.wrong} | ${pct(b.printed ? b.wrong / b.printed : null, 1)} |`);
  L.push(`\n## Instrument\n`);
  L.push(`- Crops: ${crops.filter((c) => c.crop).length} cut, ${crops.filter((c) => !c.crop).length} failed (${JSON.stringify(Object.fromEntries(Object.entries(crops.filter((c) => !c.crop).reduce((m, c) => { m[c.crop_error] = (m[c.crop_error] || 0) + 1; return m; }, {}))))}); adjudicated ${adj.filter((c) => c.printed != null).length}, unreadable ${adj.filter((c) => c.printed === 'unreadable').length}.`);
  L.push(`- Adjudication is BLIND: the reader sees a red box on the page image and reports the digits; neither engine's reading is on the sheet. \`adjudicated_by: model-eye\` (Sonnet) unless a human row exists in \`human-queue.jsonl\`.`);
  L.push(`- Breadth pages were chosen as the number-densest interior Archive leaf per book, so (b) cannot see a page where the Archive dropped every number; the dropped-number rate in (b) is a lower bound.`);
  L.push(`- The lite text for (a) is production \`pages.ocr\` (realtime, prompt ${readJsonl(F('pairs.jsonl'))[0]?.lite_prompt_version || '?'}); for (b) it is a fresh read in the eval store (run_id \`${RUN_ID}\`).`);
  fs.writeFileSync(F('report.md'), L.join('\n') + '\n');
  console.log(F('report.md'));
}

async function main() {
  const LONG = { timeoutMs: 4 * 3600 * 1000 };
  if (STAGE === 'pairs') return withMongo(stagePairs, LONG);
  if (STAGE === 'draw') return withMongo(stageDraw, LONG);
  if (STAGE === 'ocr') return withMongo(stageOcr, LONG);
  if (STAGE === 'locate') return stageLocate();
  if (STAGE === 'align') return stageAlign();
  if (STAGE === 'select') return stageSelect();
  if (STAGE === 'crops') return stageCrops();
  if (STAGE === 'merge') return stageMerge();
  if (STAGE === 'score') return stageScore();
  if (STAGE === 'fixture') return stageFixture();
  if (STAGE === 'regress') return stageRegress();
  if (STAGE === 'report') return stageReport();
  throw new Error(`unknown --stage=${STAGE}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
