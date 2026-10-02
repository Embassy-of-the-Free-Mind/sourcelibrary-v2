#!/usr/bin/env node
// Does page quality move with the book's date, the amount of text on the page, or the scan's
// resolution? Joins every audited translation page (pooled monthly audits, one page per book) and
// every referenced OCR benchmark page to three page properties, and reports stratified rates with
// intervals plus one exploratory logistic regression. Feeds the covariate panels on
// /research/quality/summary (#5615). #5623 adds manuscript vs print, holding library and page
// content (and measures format coverage), each with its coverage and the rule each value came from.
//
// PRIOR ART: quality-by-language.mjs (pools the audits by book, by LANGUAGE only — this reuses its
// pooling rule verbatim); benchmark-dashboard-data.mjs (OCR cells by catalogue period — reuses its
// file selection, reference rule and refusal-as-1.0 CER, but has no characters or resolution, and
// its `period` cell is pooled over every engine-language mix); translation-corpus-audit/score.mjs
// (by_period for one audit, no intervals by characters or resolution); lib/agreement-stats.mjs
// (wilson, bootstrapItems) and lib/paired-stats.mjs (makeRng) are used, not copied. No logistic
// regression exists in scripts/eval; the IRLS below is the first.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/quality-covariates.mjs
// Reads Mongo (bookstore.pages, read-only) for image dimensions, and image headers from
// images.sourcelibrary.org where a page carries none. Writes src/data/quality-covariates.json
// (src/data/* is gitignored: commit it with `git add -f`). $0, no model calls, unless:
//   --describe [--dry-run] [--limit=N]   run the image-only page descriptor (lib/page-descriptor.mjs,
//       gemini-3.1-flash-lite, ~$0.0005 a page) on sampled pages whose OCR text lacks <script> or
//       <page-type>, plus the agreement-check pages; answers are cached in
//       scripts/eval/output/page-descriptors-5623.json and only missing pages are called. $3 ceiling.
//   --corpus-profile [--describe]   instead: one page per visible book, corpus-wide (#5643); see
//       "corpus page profile" below. $10 ceiling.
//   --corpus-profile --typeface [--describe]   the typeface extension (#5643): the descriptor on every
//       picked page with OCR, and the descriptor's page type and flags used everywhere. $25 ceiling.

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { wilson, bootstrapItems } from './lib/agreement-stats.mjs';
import { makeRng } from './lib/paired-stats.mjs';
import { API_ENGINE } from './lib/refusals.mjs';
import { describePage, DESCRIPTOR_MODEL, DESCRIPTOR_VERSION } from './lib/page-descriptor.mjs';
import { extractScriptType, extractPageType, parseDetectedImages } from '../lib/ocr-result-parse.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { routeBook } from '../lib/syriac-kraken-lane.mjs';
import { costOf } from '../lib/model-pricing.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const RESULTS = path.join(ROOT, 'scripts/eval/results');
const SEED = 20261002;
const LITE = 'gemini-3.1-flash-lite';
const FLASH = 'gemini-3-flash-preview';
const GRADE = (n) => (n >= 50 ? 'decision-grade' : n >= 30 ? 'directional' : 'exploratory');
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);

// ── period ────────────────────────────────────────────────────────────────────
// `books.published` is free text: "1480", "[ca. 1780]", "1785-1789", "14th century", "14uu",
// "Unknown", "1500–1825", "-1000". A year is taken only when the text pins it to one century:
// a single 3–4 digit year, a range inside one century, an "Nth century", or a "14uu"-style
// cataloguer's year. A range across centuries, a BCE date, or Roman numerals stays unknown.
const PERIODS = ['pre-1500', '1500s', '1600s', '1700s', '1800s', '1900+', 'unknown'];
const bucket = (y) => (y < 1500 ? 'pre-1500' : y < 1600 ? '1500s' : y < 1700 ? '1600s' : y < 1800 ? '1700s' : y < 1900 ? '1800s' : '1900+');
function periodOf(published, fallbackYear = null) {
  const s = String(published ?? '').trim();
  if (/^-\d/.test(s) || /\bB\.?C\.?E?\b/i.test(s)) return 'unknown';
  const one = (ys) => { const bs = new Set(ys.map(bucket)); return bs.size === 1 ? [...bs][0] : 'unknown'; };
  // "14th century", "10th–11th century", "16th or 17th century": every ordinal must fall in one bucket.
  if (/century/i.test(s)) {
    const cs = [...s.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi)].map((m) => (Number(m[1]) - 1) * 100 + 50);
    if (cs.length) return one(cs);
  }
  const uu = s.match(/\b(1\d)uu\b/i);
  if (uu) return bucket(Number(uu[1]) * 100 + 50);
  // Four-digit years first; a three-digit number counts only when no four-digit year is present
  // ("Vol. 27, No. 321, pp. 407–417. Tokyo, 1913" is 1913, not a range from 321).
  const four = [...s.matchAll(/(?<![\d])(\d{4})(?![\d])/g)].map((m) => Number(m[1])).filter((y) => y >= 1000 && y <= 2030);
  const years = four.length ? four : [...s.matchAll(/(?<![\d])(\d{3})(?![\d])/g)].map((m) => Number(m[1])).filter((y) => y >= 300);
  if (years.length) {
    const bs = new Set(years.map(bucket));
    return bs.size === 1 ? [...bs][0] : 'unknown';
  }
  return typeof fallbackYear === 'number' && Number.isFinite(fallbackYear) ? bucket(fallbackYear) : 'unknown';
}

// ── characters ────────────────────────────────────────────────────────────────
// The served transcription with its structural tags (<scan-quality>, <header>, <sig> …) removed,
// counted in non-space characters, so a CJK page and a Latin page are on one (imperfect) scale.
const contentChars = (src) => String(src || '').replace(/<[^>\n]{1,80}>[^<\n]*<\/[^>\n]{1,40}>/g, '').replace(/<[^>\n]{1,80}>/g, '').replace(/\s+/g, '').length;

// ── resolution ────────────────────────────────────────────────────────────────
// The stored master scan's long edge in pixels (pages.image_width/height, written when the image was
// archived). A split page is read from its crop, so its own crop image is measured instead. The
// reader's display copy (`display_photo`) is capped at 2,000 px wide and would hide the difference.
const RES_BANDS = ['<1500 px', '1500–2499 px', '≥2500 px', 'unknown'];
const resBand = (longEdge) => (!longEdge ? 'unknown' : longEdge < 1500 ? '<1500 px' : longEdge < 2500 ? '1500–2499 px' : '≥2500 px');
async function jpegOrPngSize(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-131071', 'User-Agent': 'sourcelibrary-eval/quality-covariates' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok && res.status !== 206) return null;
    const b = Buffer.from(await res.arrayBuffer());
    if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  } catch { /* unreadable header: resolution stays unknown */ }
  return null;
}
async function iiifSize(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sourcelibrary-eval/quality-covariates' }, signal: AbortSignal.timeout(20000) });
    const j = res.ok ? await res.json() : null;
    return j?.width && j?.height ? { w: j.width, h: j.height } : null;
  } catch { return null; }
}
async function resolutionFor(db, keys) {
  // keys: [{ key, page_id?, book_id, page_number }]
  const ids = keys.filter((k) => k.page_id).map((k) => k.page_id);
  const proj = { projection: { id: 1, book_id: 1, page_number: 1, image_width: 1, image_height: 1, image_metadata: 1, cropped_photo: 1, archived_photo: 1, photo: 1 } };
  const byId = new Map((await db.collection('pages').find({ id: { $in: ids } }, proj).toArray()).map((p) => [p.id, p]));
  const byBp = new Map();
  const bps = keys.filter((k) => !k.page_id && k.book_id && Number.isFinite(k.page_number));
  if (bps.length) {
    const ps = await db.collection('pages').find({ $or: bps.map((k) => ({ book_id: k.book_id, page_number: k.page_number })) }, proj).toArray();
    for (const p of ps) byBp.set(`${p.book_id}|${p.page_number}`, p);
  }
  const out = new Map();
  const queue = [];
  for (const k of keys) {
    const p = k.page_id ? byId.get(k.page_id) : byBp.get(`${k.book_id}|${k.page_number}`);
    if (!p) { out.set(k.key, { long_edge: null, source: 'no page record' }); continue; }
    if (p.cropped_photo && /images\.sourcelibrary\.org/.test(p.cropped_photo)) { queue.push([k.key, p.cropped_photo, 'crop header']); continue; }
    const w = p.image_width ?? p.image_metadata?.width, h = p.image_height ?? p.image_metadata?.height;
    if (w && h) { out.set(k.key, { long_edge: Math.max(w, h), w, h, source: 'pages.image_width/height' }); continue; }
    const url = [p.archived_photo, p.photo].find((u) => u && /images\.sourcelibrary\.org/.test(u));
    // A page never archived is read straight from the library's IIIF server: its info.json carries the size.
    const iiif = !url && [p.photo].find((u) => u && /\/iiif\/image\/v[23]\/[^/]+\/full\/[^/]+\/\d+\/default\.(jpg|png)$/.test(u));
    if (url) queue.push([k.key, url, 'image header']);
    else if (iiif) queue.push([k.key, iiif.replace(/\/full\/[^/]+\/\d+\/default\.(jpg|png)$/, '/info.json'), 'IIIF info.json']);
    else out.set(k.key, { long_edge: null, source: 'no measurable image' });
  }
  for (let i = 0; i < queue.length; i += 8) {
    await Promise.all(queue.slice(i, i + 8).map(async ([key, url, source]) => {
      const d = url.endsWith('/info.json') ? await iiifSize(url) : await jpegOrPngSize(url);
      out.set(key, d ? { long_edge: Math.max(d.w, d.h), w: d.w, h: d.h, source } : { long_edge: null, source: `${source} unreadable` });
    }));
  }
  return out;
}

// ── manuscript, holding library, page content, format (#5623) ─────────────────
// Manuscript vs print, per page, is the OCR read's own `<script>printed|handwritten|mixed</script>`
// tag. Where the page has none (Archive OCR, older Gemini prompts, e-text imports), the image-only
// descriptor (lib/page-descriptor.mjs, `--describe`) supplies it. The BOOK's label is the majority
// over every tagged page it has (the sampled page's descriptor answer counts as one more page);
// a book with no tag anywhere falls back to routeBook() of the Syriac lane: a manuscript library
// or a date before 1500 means manuscript, anything else print. Each row records which rule fired.
const MS_LEVELS = ['print', 'manuscript', 'mixed'];
const MS_OF = { printed: 'print', handwritten: 'manuscript', mixed: 'mixed' };
const CONTENT_LEVELS = ['plain text', 'marginalia', 'table', 'illustration', 'unknown'];
const ILLUS_TYPES = new Set(['illustration', 'diagram', 'map', 'frontispiece']);
const DESCRIPTOR_FILE = path.join(ROOT, 'scripts/eval/output/page-descriptors-5623.json');
const AGREEMENT_N = 40;
// The Munich Digitization Centre (mdz) is the Bavarian State Library's (bsb) scanning arm: one holder.
const PROVIDER_ALIAS = { mdz: 'bsb', british_library: 'bl' };
const HOST_PROVIDER = [[/archive\.org/, 'internet_archive'], [/digitale-sammlungen\.de|bsb-muenchen/, 'bsb'], [/gallica\.bnf\.fr/, 'gallica'], [/e-rara\.ch/, 'e-rara'], [/wikimedia\.org/, 'wikimedia_commons'], [/bl\.uk/, 'bl'], [/books\.google/, 'google_books']];
const tagCounts = (o) => Object.values(o || {}).reduce((s, x) => s + x, 0);
function formatOf(f) {
  const s = String(f ?? '').trim().toLowerCase();
  if (!s) return null;
  const n = Number(/^(\d{1,2})\s*(?:°|o\b|mo\b|to\b|vo\b)/.exec(s)?.[1] ?? (/^folio|^fol\b/.test(s) ? 2 : /^quarto/.test(s) ? 4 : /^octavo/.test(s) ? 8 : NaN));
  return n === 2 ? '2°' : n === 4 ? '4°' : n === 8 ? '8°' : n >= 12 ? '12° and smaller' : 'other';
}
// What the transcription itself shows. Only a Gemini read was asked for <margin>, markdown tables and
// the <detected-images> block, so on any other engine's text these are unknown, not "absent".
function inlineFacts(text) {
  const t = String(text || '');
  const columnsTag = /<columns>\s*(\d+)\s*<\/columns>/i.exec(t);
  return {
    script: extractScriptType(t) ?? null,
    page_type: extractPageType(t) ?? null,
    columns: columnsTag ? Number(columnsTag[1]) : null,
    has_marginalia: /<margin>/i.test(t),
    has_table: /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/m.test(t),
    has_illustration: parseDetectedImages(t).length > 0 || /<image-desc>/i.test(t),
  };
}

async function pageFacts(db, tRows, oRows) {
  const proj = { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, page_type: 1, cropped_photo: 1, split_from_spread: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, photo: 1, crop: 1, archive_metadata: 1 } };
  const pages = new Map(); // page id -> page
  const keyToPage = new Map(); // row key -> page id
  const tIds = tRows.map((r) => r.page_id).filter(Boolean);
  for (const p of await db.collection('pages').find({ id: { $in: tIds } }, proj).toArray()) pages.set(p.id, p);
  for (const r of tRows) if (pages.has(r.page_id)) keyToPage.set(r.key, r.page_id);
  const bps = [...new Map(oRows.filter((r) => r.book_id && Number.isFinite(r.page_number)).map((r) => [`${r.book_id}|${r.page_number}`, r])).values()];
  const byBp = new Map();
  for (let i = 0; i < bps.length; i += 200) {
    const ps = await db.collection('pages').find({ $or: bps.slice(i, i + 200).map((r) => ({ book_id: r.book_id, page_number: r.page_number })) }, proj).toArray();
    for (const p of ps) { byBp.set(`${p.book_id}|${p.page_number}`, p); pages.set(p.id, p); }
  }
  for (const r of oRows) { const p = byBp.get(`${r.book_id}|${r.page_number}`); if (p) keyToPage.set(r.key, p.id); }

  const bookIds = [...new Set([...tRows, ...oRows].map((r) => r.book_id).filter(Boolean))];
  const bproj = { projection: { id: 1, published: 1, format: 1, 'image_source.provider': 1, 'image_source.source_url': 1 } };
  const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, bproj).toArray()).map((b) => [b.id, b]));
  // Every page's <script> tag across each book, counted server-side (the texts never leave Mongo).
  const bookTags = new Map();
  for (let i = 0; i < bookIds.length; i += 50) {
    const agg = await db.collection('pages').aggregate([
      { $match: { book_id: { $in: bookIds.slice(i, i + 50) }, 'ocr.data': { $type: 'string' } } },
      { $project: { book_id: 1, m: { $regexFind: { input: '$ocr.data', regex: '<script>\\s*(printed|handwritten|mixed)\\s*</script>', options: 'i' } } } },
      { $group: { _id: { b: '$book_id', s: { $toLower: { $ifNull: [{ $arrayElemAt: ['$m.captures', 0] }, 'none'] } } }, n: { $sum: 1 } } },
    ], { allowDiskUse: true }).toArray();
    for (const g of agg) { const o = bookTags.get(g._id.b) || {}; o[g._id.s] = g.n; bookTags.set(g._id.b, o); }
  }
  return { pages, keyToPage, books, bookTags };
}

/**
 * The image-only descriptor, for every sampled page whose OCR text lacks <script> or <page-type>,
 * plus AGREEMENT_N pages that carry both (the check against the inline tags). `--describe` calls
 * the model for pages not yet in the cache file; without it the cache is read as is. `--dry-run`
 * prints what would be called and the estimate.
 */
async function descriptorStep({ pages }) {
  const cache = fs.existsSync(DESCRIPTOR_FILE) ? JSON.parse(fs.readFileSync(DESCRIPTOR_FILE, 'utf8')) : { pages: {} };
  const want = [];
  const tagged = [];
  for (const p of pages.values()) {
    const f = inlineFacts(p.ocr?.data);
    const url = getPageSource(p);
    if (!f.script || !f.page_type) want.push({ p, url, reason: 'missing-tags' });
    else if (/^gemini/.test(p.ocr?.model || '')) tagged.push({ p, url, reason: 'agreement-check' });
  }
  const rng = makeRng(SEED + 5623);
  const check = tagged.sort((a, b) => a.p.id.localeCompare(b.p.id)).map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).slice(0, AGREEMENT_N).map(([, x]) => x);
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  // The random check is almost all print, so every sampled page the OCR tagged handwritten or mixed
  // is checked as well (up to AGREEMENT_N): the manuscript covariate leans on the descriptor's hands.
  const checkIds = new Set(check.map((x) => x.p.id));
  const hand = tagged.filter((x) => !checkIds.has(x.p.id) && ['handwritten', 'mixed'].includes(extractScriptType(x.p.ocr?.data))).slice(0, AGREEMENT_N).map((x) => ({ ...x, reason: 'agreement-check-hand' }));
  check.push(...hand);
  const todo = [...want, ...check].filter((x) => !cache.pages[x.p.id]?.value && x.url).slice(0, limitArg ? Number(limitArg.slice(8)) : Infinity);
  const noImage = [...want, ...check].filter((x) => !x.url).length;
  const EST_IN = 1400, EST_OUT = 120; // a 1,536 px page plus the prompt; revised after the first calls
  const estimate = todo.length * costOf(DESCRIPTOR_MODEL, EST_IN, EST_OUT);
  console.log(`descriptor: ${want.length} pages missing a tag, ${check.length} agreement-check pages, ${todo.length} still to call, ${noImage} with no image; estimate $${estimate.toFixed(3)} (realtime list price)`);
  if (process.argv.includes('--describe') && todo.length) {
    if (estimate > 3) throw new Error(`descriptor estimate $${estimate.toFixed(2)} is over the $3 ceiling (#5623) — stop`);
    if (process.argv.includes('--dry-run')) process.exit(0);
    let spent = Object.values(cache.pages).reduce((s, x) => s + (x.usd || 0), 0);
    for (let i = 0; i < todo.length; i += 8) {
      await Promise.all(todo.slice(i, i + 8).map(async ({ p, url, reason }) => {
        try {
          const d = await describePage({ imageUrl: url, endpoint: 'scripts/eval/quality-covariates.mjs#describe', bookId: p.book_id, pageId: p.id });
          cache.pages[p.id] = { book_id: p.book_id, page_number: p.page_number, image_url: url, reason, ocr_model: p.ocr?.model ?? null, ...d };
          spent += d.usd;
        } catch (e) {
          cache.pages[p.id] = { book_id: p.book_id, page_number: p.page_number, image_url: url, reason, ocr_model: p.ocr?.model ?? null, value: null, errors: [String(e.message || e).slice(0, 200)] };
        }
      }));
      if (spent > 3) throw new Error(`descriptor spend $${spent.toFixed(2)} passed the $3 ceiling — stop`);
      Object.assign(cache, { model: DESCRIPTOR_MODEL, prompt_version: DESCRIPTOR_VERSION, issue: 5623, updated: new Date().toISOString(), usd: Math.round(spent * 10000) / 10000, calls: Object.values(cache.pages).filter((x) => x.input_tokens).length });
      fs.mkdirSync(path.dirname(DESCRIPTOR_FILE), { recursive: true });
      fs.writeFileSync(DESCRIPTOR_FILE, JSON.stringify(cache, null, 1) + '\n');
      process.stdout.write(`\r  described ${Math.min(i + 8, todo.length)}/${todo.length}  $${spent.toFixed(3)}`);
    }
    console.log('');
  }
  return { cache, wanted: want.length, check: check.filter((x) => x.reason === 'agreement-check').map((x) => x.p.id), check_hand: hand.map((x) => x.p.id), no_image: noImage };
}

/** Resolve every row's manuscript label, provider, content class and format, recording each value's source. */
function applyFacts(rows, { pages, keyToPage, books, bookTags }, { cache }) {
  for (const r of rows) {
    const p = pages.get(keyToPage.get(r.key));
    const b = r.book_id ? books.get(r.book_id) : null;
    if (!b && !p) {
      Object.assign(r, { ms: 'unknown', ms_rule: 'external reference scan (no Source Library book)', ms_rule_class: 'external scan: unknown', page_script: null, page_script_src: 'none', provider: 'unknown', provider_src: 'none', content: 'unknown', content_src: 'none', format: null });
      continue;
    }
    const f = inlineFacts(p?.ocr?.data);
    const d = p ? cache.pages[p.id]?.value : null;
    r.page_script = f.script ?? d?.script ?? null;
    r.page_script_src = f.script ? 'ocr <script> tag' : d?.script ? 'descriptor' : 'none';
    r.page_type = f.page_type ?? d?.page_type ?? null;
    r.page_type_src = f.page_type ? 'ocr <page-type> tag' : d?.page_type ? 'descriptor' : 'none';
    r.typeface = d?.typeface ?? null;
    // book: majority over its tagged pages (+ this page's descriptor answer when its own tag is absent)
    const counts = { ...(bookTags.get(r.book_id) || {}) };
    delete counts.none;
    if (!f.script && d?.script) counts[d.script] = (counts[d.script] || 0) + 1;
    const n = tagCounts(counts);
    if (n) {
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const tie = top.length > 1 && top[0][1] === top[1][1];
      r.ms = tie ? 'mixed' : MS_OF[top[0][0]];
      r.ms_rule = !f.script && d?.script && n === 1 ? 'descriptor (this page; the book has no tagged page)' : `book majority of ${n} tagged page${n > 1 ? 's' : ''}${tie ? ' (tie, counted mixed)' : ''}`;
      r.ms_counts = counts;
      r.ms_rule_class = r.ms_rule.startsWith('descriptor') ? 'descriptor (this page only)' : 'OCR <script> tags, book majority';
      // What the fallback rule would have said, so its accuracy can be read off the books the tags decide.
      r.ms_fallback = routeBook(b || {}, {}).route === 'manuscript' ? 'manuscript' : 'print';
    } else {
      const route = routeBook(b || {}, {});
      r.ms = route.route === 'manuscript' ? 'manuscript' : 'print';
      r.ms_rule = `fallback routeBook: ${route.why}`;
      r.ms_rule_class = route.route === 'print' ? 'fallback: print by default' : /^published/.test(route.why) ? 'fallback: published before 1500' : 'fallback: manuscript library';
    }
    // holding library
    const prov = String(b?.image_source?.provider || '').toLowerCase();
    if (prov) { r.provider = PROVIDER_ALIAS[prov] || prov; r.provider_src = 'books.image_source.provider'; }
    else {
      const url = [p?.archive_metadata?.source_url, b?.image_source?.source_url, p?.photo_original, p?.photo].find(Boolean) || '';
      const hit = HOST_PROVIDER.find(([re]) => re.test(url));
      r.provider = hit ? hit[1] : 'unknown';
      r.provider_src = hit ? 'image host' : 'none';
    }
    // page content: one class, illustration > table > marginalia > plain text
    const gemini = /^gemini/.test(p?.ocr?.model || '') && !!f.script;
    const src = gemini ? { illus: ILLUS_TYPES.has(f.page_type) || f.has_illustration, table: f.page_type === 'table' || f.has_table, margin: f.has_marginalia } : d ? { illus: ILLUS_TYPES.has(d.page_type) || d.has_illustration, table: d.page_type === 'table' || d.has_table, margin: d.has_marginalia } : null;
    r.content = !src ? 'unknown' : src.illus ? 'illustration' : src.table ? 'table' : src.margin ? 'marginalia' : 'plain text';
    r.content_src = gemini ? 'transcription tags (Gemini read)' : d ? 'descriptor' : 'none';
    r.format = formatOf(b?.format);
  }
  const cov = (rs) => {
    const tally = (k) => rs.reduce((a, r) => ((a[r[k]] = (a[r[k]] || 0) + 1), a), {});
    return { n: rs.length, page_script_src: tally('page_script_src'), ms_rule: tally('ms_rule_class'), ms: tally('ms'), provider_src: tally('provider_src'), content_src: tally('content_src'), content: tally('content'), format: tally('format') };
  };
  const tRows = rows.filter((r) => r.key.startsWith('t|'));
  return { translation: cov(tRows), ocr_lite: cov(rows.filter((r) => r.key.startsWith('o|') && r.engine === LITE)) };
}

/** What the descriptor run cost, what it said where tags were missing, and how it agrees with the inline tags. */
function descriptorReport({ pages }, { cache, wanted, check, check_hand }) {
  const entries = Object.entries(cache.pages || {});
  const ok = entries.filter(([, v]) => v.value);
  const family = (m) => (!m ? 'no engine recorded' : /^gemini/.test(m) ? m.replace(/-preview$/, '') : m.split(/[/@-]/)[0]);
  const byEngine = {};
  for (const [, v] of ok.filter(([, v]) => v.reason === 'missing-tags')) {
    const e = (byEngine[family(v.ocr_model)] ||= { n: 0, printed: 0, handwritten: 0, mixed: 0 });
    e.n++; if (v.value.script) e[v.value.script]++;
  }
  const agreeOn = (ids) => {
    const agree = { script: [], page_type: [], columns: [], has_marginalia: [], has_table: [], has_illustration: [] };
    const confusion = {};
    for (const id of ids) {
      const d = cache.pages[id]?.value, p = pages.get(id);
      if (!d || !p) continue;
      const f = inlineFacts(p.ocr?.data);
      agree.script.push(d.script === f.script);
      (confusion[`${f.script} → ${d.script}`] ||= 0), confusion[`${f.script} → ${d.script}`]++;
      agree.page_type.push(d.page_type === f.page_type);
      agree.columns.push(Math.max(1, d.columns ?? 1) === (f.columns ?? 1));
      agree.has_marginalia.push(d.has_marginalia === f.has_marginalia);
      agree.has_table.push(d.has_table === (f.has_table || f.page_type === 'table'));
      agree.has_illustration.push(d.has_illustration === (f.has_illustration || ILLUS_TYPES.has(f.page_type)));
    }
    return { agree, confusion };
  };
  const { agree, confusion } = agreeOn(check);
  const handCheck = agreeOn(check_hand);
  // The same page type on pages whose OCR carries <page-type> but not <script> (older prompt versions).
  for (const [id, v] of ok.filter(([, v]) => v.reason === 'missing-tags')) {
    const f = inlineFacts(pages.get(id)?.ocr?.data);
    if (f.page_type && !f.script) (agree.page_type_partial ||= []).push(v.value.page_type === f.page_type);
  }
  const direction = Object.fromEntries(['has_marginalia', 'has_table', 'has_illustration'].map((k) => [k, { descriptor_only: 0, transcription_only: 0 }]));
  for (const id of check) {
    const d = cache.pages[id]?.value, p = pages.get(id);
    if (!d || !p) continue;
    const f = inlineFacts(p.ocr?.data);
    const inline = { has_marginalia: f.has_marginalia, has_table: f.has_table || f.page_type === 'table', has_illustration: f.has_illustration || ILLUS_TYPES.has(f.page_type) };
    for (const k of Object.keys(direction)) if (d[k] !== inline[k]) direction[k][d[k] ? 'descriptor_only' : 'transcription_only']++;
  }
  const share = (xs) => { const k = xs.filter(Boolean).length, [lo, hi] = wilson(k, xs.length); return { n: xs.length, agree: k, rate: xs.length ? r3(k / xs.length) : null, ci: xs.length ? [r3(lo), r3(hi)] : null }; };
  return {
    file: path.relative(ROOT, DESCRIPTOR_FILE), model: DESCRIPTOR_MODEL, prompt_version: DESCRIPTOR_VERSION, prompt: 'scripts/eval/lib/page-descriptor.mjs',
    pages_missing_a_tag: wanted, described: ok.length, failed: entries.length - ok.length,
    failures: Object.entries(entries.filter(([, v]) => !v.value).reduce((a, [, v]) => { const k = String(v.errors?.[0] || '').replace(/ https?:\/\/\S+/, '').slice(0, 60); a[k] = (a[k] || 0) + 1; return a; }, {})),
    field_errors: ok.filter(([, v]) => v.errors?.length).length,
    usd: r3(cache.usd ?? 0), billing: 'realtime list price through scripts/lib/gemini-script-client.mjs (the client has no Batch path)',
    input_tokens: ok.reduce((x, [, v]) => x + (v.input_tokens || 0), 0), output_tokens: ok.reduce((x, [, v]) => x + (v.output_tokens || 0), 0),
    script_where_tag_missing_by_engine: byEngine,
    agreement_with_inline_tags: { pages: check.length, ...Object.fromEntries(Object.entries(agree).map(([k, xs]) => [k, share(xs)])), script_confusion: confusion, flag_disagreements: direction },
    agreement_on_handwritten_or_mixed_tags: { pages: check_hand.length, script: share(handCheck.agree.script), page_type: share(handCheck.agree.page_type), has_marginalia: share(handCheck.agree.has_marginalia), script_confusion: handCheck.confusion },
  };
}

// ── corpus page profile (#5643) ───────────────────────────────────────────────
// One page per visible book (visible, pages_count > 4): the middle page, ceil(pages_count / 2);
// if it has no OCR, the next page after it that has, else the nearest one before it (page 1 or
// later: a few books carry negative page numbers for relocated leaves). No seed is
// needed: the fallback is fully determined by page order. Each value records where it came from.
// Inline first, at $0: pages.script_type / page_type / columns (stored, #5629), else the OCR text's
// own <script> / <page-type> / <columns> tags. The descriptor (lib/page-descriptor.mjs) runs only
// on books with OCR whose page lacks a usable page type or script. Its `script` is NOT used on a
// CJK or Tibetan page (by-eye check on #5623: it reads neat East Asian hands as print); those stay
// unknown without an inline tag. Typeface and page type from it are used for every script.
// Nothing is written to Mongo. Three files, all resumable (each is appended a row at a time):
//   <base>.walk.jsonl         the $0 walk: one row per book, inline values only
//   <base>.descriptors.jsonl  one descriptor answer per book that needed one
//   <base>.jsonl + <base>.summary.json   the merged profile and its counts (Wilson 95%)
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/quality-covariates.mjs \
//     --corpus-profile [--date=YYYY-MM-DD] [--describe] [--limit=N]
// Without --describe it walks (or resumes the walk), prints the descriptor count and estimate, and
// writes the profile from whatever answers exist. $10 ceiling with a 2× margin on the estimate.
//
// --typeface (the extension approved on #5643): no OCR prompt ever wrote a typeface, so the first
// pass knew it only on the 17% of books it described. This pass runs the same descriptor on every
// other picked page that has OCR (same page per book; answers append to the same descriptors file,
// tagged pass: 'typeface'). Its spend is metered from the first 200 calls of the pass and stopped if
// the projection passes TYPEFACE_CEILING. The merge then takes typeface, page type and the three
// flags from the descriptor wherever it answered; script keeps the inline-first rule and the
// CJK/Tibetan exclusion; columns are unchanged. It writes <base>-typeface.jsonl / .summary.json
// (the first pass's files are left as they are), with the profile also counted without the
// "previous page with OCR" picks, and the descriptor's page type checked against pages.page_type.
const PROFILE_CEILING = 10;
const TYPEFACE = process.argv.includes('--typeface');
const TYPEFACE_CEILING = 25;
const TYPEFACE_METER = 200;
const PROFILE_CONCURRENCY = 8;
const CJK_LANG = /chinese|japanese|korean|kanbun|tibetan/i;
// Share of letters in Han, kana, Hangul or Tibetan blocks, over the first 4,000 characters.
function scriptFamily(text, language) {
  const s = String(text || '').replace(/<[^>\n]{1,80}>/g, '').slice(0, 4000);
  let letters = 0, cjk = 0, tib = 0;
  for (const ch of s) {
    if (/\p{L}/u.test(ch)) letters++;
    if (/[぀-ヿ㐀-鿿豈-﫿가-힯ᄀ-ᇿ]/.test(ch)) cjk++;
    else if (/[ༀ-࿿]/.test(ch)) tib++;
  }
  if (letters >= 20 && (cjk + tib) / letters >= 0.3) return { family: tib > cjk ? 'tibetan' : 'cjk', family_src: 'ocr text characters' };
  const l = String(language || '');
  if (CJK_LANG.test(l)) return { family: /tibetan/i.test(l) ? 'tibetan' : 'cjk', family_src: 'books.language' };
  return { family: 'other', family_src: letters >= 20 ? 'ocr text characters' : 'books.language' };
}
const readLines = async function* (f) {
  if (!fs.existsSync(f)) return;
  const rl = (await import('node:readline')).createInterface({ input: fs.createReadStream(f, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) { try { yield JSON.parse(line); } catch { /* a torn last line from a kill: skipped, redone */ } }
};
async function mapLimit(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const j = i++; await fn(items[j], j); } }));
}

async function profileWalk(db, base) {
  const booksFile = `${base}.books.jsonl`, walkFile = `${base}.walk.jsonl`;
  if (!fs.existsSync(booksFile)) {
    // The book list first, streamed to disk; the cursor is closed before any page lookup.
    const tmp = `${booksFile}.tmp`, w = fs.createWriteStream(tmp);
    const cur = db.collection('books').find({ visible: true, pages_count: { $gt: 4 } }, { projection: { _id: 0, id: 1, title: 1, language: 1, published: 1, year: 1, pages_count: 1, 'image_source.provider': 1 } }).sort({ id: 1 });
    for await (const b of cur) if (!w.write(JSON.stringify({ id: b.id, title: String(b.title || '').slice(0, 80), language: b.language ?? null, published: b.published ?? null, year: b.year ?? null, pages_count: b.pages_count, provider: b.image_source?.provider ?? null }) + '\n')) await new Promise((r) => w.once('drain', r));
    await new Promise((r) => w.end(r));
    fs.renameSync(tmp, booksFile);
  }
  const done = new Set();
  for await (const r of readLines(walkFile)) done.add(r.book_id);
  const out = fs.createWriteStream(walkFile, { flags: 'a' });
  const proj = { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, script_type: 1, page_type: 1, columns: 1, cropped_photo: 1, split_from_spread: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, photo: 1 } };
  const hasOcr = (p) => typeof p?.ocr?.data === 'string' && /\S/.test(p.ocr.data);
  const withOcr = { 'ocr.data': { $type: 'string', $ne: '' } };
  let chunk = [], walked = done.size;
  const flush = async () => {
    const rows = [];
    await mapLimit(chunk, PROFILE_CONCURRENCY, async (b) => {
      const mid = Math.ceil(b.pages_count / 2);
      const pages = db.collection('pages');
      let p = await pages.findOne({ book_id: b.id, page_number: mid }, proj), picked = 'middle';
      if (!hasOcr(p)) {
        const next = await pages.find({ book_id: b.id, page_number: { $gt: mid }, ...withOcr }, proj).sort({ page_number: 1 }).limit(1).next();
        const prev = !next && (await pages.find({ book_id: b.id, page_number: { $lt: mid, $gte: 1 }, ...withOcr }, proj).sort({ page_number: -1 }).limit(1).next());
        if (next || prev) { p = next || prev; picked = next ? 'next page with OCR' : 'previous page with OCR'; }
        else picked = p ? 'middle (book has no OCR)' : 'no page record at the middle';
      }
      const text = hasOcr(p) ? p.ocr.data : '';
      const f = inlineFacts(text);
      const pick = (stored, storedSrc, tag, tagSrc) => (stored != null && stored !== '' ? [stored, storedSrc] : tag != null ? [tag, tagSrc] : [null, 'none']);
      const [script, script_src] = pick(['printed', 'handwritten', 'mixed'].includes(p?.script_type) ? p.script_type : null, 'pages.script_type', f.script, 'ocr <script> tag');
      const [page_type, page_type_src] = pick(p?.page_type, 'pages.page_type', f.page_type, 'ocr <page-type> tag');
      const [columns, columns_src] = pick(Number.isInteger(p?.columns) ? p.columns : null, 'pages.columns', f.columns, 'ocr <columns> tag');
      const fam = scriptFamily(text, b.language);
      // Flags only where a Gemini read was asked for them (see inlineFacts); elsewhere unknown.
      const gemini = /^gemini/.test(p?.ocr?.model || '') && !!f.script;
      const image_url = p ? getPageSource(p) : null;
      const has_ocr = !!text;
      rows.push({
        book_id: b.id, title: b.title, language: b.language, published: b.published, period: periodOf(b.published, typeof b.year === 'number' ? b.year : null),
        pages_count: b.pages_count, provider: b.provider, page_id: p?.id ?? null, page_number: p?.page_number ?? null, picked, has_ocr,
        ocr_model: p?.ocr?.model ?? null, ocr_source: p?.ocr?.source ?? null, image_url, ...fam,
        script, script_src, page_type, page_type_src, columns, columns_src,
        flags: gemini ? { has_illustration: f.has_illustration || ILLUS_TYPES.has(f.page_type), has_table: f.has_table || f.page_type === 'table', has_marginalia: f.has_marginalia } : null,
        needs_descriptor: has_ocr && !!image_url && (!page_type || (!script && fam.family === 'other')),
      });
    });
    out.write(rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    walked += chunk.length;
    process.stdout.write(`\r  walked ${walked}`);
    chunk = [];
  };
  for await (const b of readLines(booksFile)) {
    if (done.has(b.id)) continue;
    chunk.push(b);
    if (chunk.length >= 200) await flush();
  }
  if (chunk.length) await flush();
  await new Promise((r) => out.end(r));
  console.log('');
}

async function profileDescribe(base) {
  const walkFile = `${base}.walk.jsonl`, dFile = `${base}.descriptors.jsonl`;
  const done = new Set();
  let spent = 0, calls = 0;
  // A failed call (429, image server busy) is not done: the next run retries it.
  // The typeface pass meters itself: its own spend and calls, apart from the first pass's.
  let passSpent = 0, passCalls = 0;
  for await (const d of readLines(dFile)) {
    if (d.value) done.add(d.book_id); spent += d.usd || 0; calls += d.input_tokens ? 1 : 0;
    if (d.pass === 'typeface') { passSpent += d.usd || 0; passCalls += d.input_tokens ? 1 : 0; }
  }
  const todo = [];
  let need = 0;
  // The first pass: books whose page lacks an inline page type or script. --typeface: every picked
  // page with OCR (books with no OCR stay counted and skipped, as the issue decided).
  const wants = (r) => (TYPEFACE ? r.has_ocr && !!r.image_url : r.needs_descriptor);
  for await (const r of readLines(walkFile)) if (wants(r)) { need++; if (!done.has(r.book_id)) todo.push({ book_id: r.book_id, page_id: r.page_id, page_number: r.page_number, image_url: r.image_url }); }
  const perCall = (() => { const c = fs.existsSync(DESCRIPTOR_FILE) ? JSON.parse(fs.readFileSync(DESCRIPTOR_FILE, 'utf8')) : null; return c?.usd && c?.calls ? c.usd / c.calls : costOf(DESCRIPTOR_MODEL, 1400, 120); })();
  const estimate = todo.length * perCall;
  console.log(`descriptor: ${need} books need it, ${done.size} answered, ${todo.length} to call; $${perCall.toFixed(6)}/call measured on #5623 → estimate $${estimate.toFixed(2)} (2× = $${(2 * estimate).toFixed(2)}); spent so far $${spent.toFixed(3)}${TYPEFACE ? `, this pass $${passSpent.toFixed(3)} over ${passCalls} calls` : ''}`);
  if (!process.argv.includes('--describe') || !todo.length) return { need, todo: todo.length, perCall, estimate, spent, passSpent, passCalls };
  if (!TYPEFACE && 2 * estimate + spent > PROFILE_CEILING) throw new Error(`2× estimate $${(2 * estimate).toFixed(2)} + spent $${spent.toFixed(2)} is over the $${PROFILE_CEILING} ceiling (#5643) — stop`);
  // --typeface: projected = spent this pass + what is left × $/call measured on this pass's calls
  // (once there are TYPEFACE_METER of them). Checked after every batch of 200.
  const overProjection = () => {
    if (!TYPEFACE || passCalls < TYPEFACE_METER) return null;
    const measured = passSpent / passCalls, projected = passSpent + (todo.length - n) * measured;
    return projected > TYPEFACE_CEILING ? `projected $${projected.toFixed(2)} ($${measured.toFixed(6)}/call over ${passCalls} calls, ${todo.length - n} left) is over the $${TYPEFACE_CEILING} ceiling (#5643 typeface) — stop` : null;
  };
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const run = todo.slice(0, limitArg ? Number(limitArg.slice(8)) : Infinity);
  const out = fs.createWriteStream(dFile, { flags: 'a' });
  let n = 0;
  let metered = passCalls >= TYPEFACE_METER;
  for (let i = 0; i < run.length; i += 200) {
    await mapLimit(run.slice(i, i + 200), PROFILE_CONCURRENCY, async (t) => {
      let row;
      try {
        const d = await describePage({ imageUrl: t.image_url, endpoint: 'scripts/eval/quality-covariates.mjs#corpus-profile', bookId: t.book_id, pageId: t.page_id });
        row = { ...t, ...d, ...(TYPEFACE && { pass: 'typeface' }) };
        spent += d.usd; calls++;
        if (TYPEFACE) { passSpent += d.usd; passCalls++; }
      } catch (e) {
        row = { ...t, value: null, errors: [String(e.message || e).slice(0, 200)], ...(TYPEFACE && { pass: 'typeface' }) };
      }
      out.write(JSON.stringify(row) + '\n');
      n++;
    });
    process.stdout.write(`\r  described ${n}/${run.length}  $${spent.toFixed(3)}${TYPEFACE ? `  pass $${passSpent.toFixed(3)}` : ''}`);
    if (TYPEFACE && !metered && passCalls >= TYPEFACE_METER) { metered = true; console.log(`\n  metered: $${(passSpent / passCalls).toFixed(6)}/call over ${passCalls} calls → projected $${(passSpent + (todo.length - n) * passSpent / passCalls).toFixed(2)}`); }
    const over = overProjection();
    if (over) { await new Promise((r) => out.end(r)); throw new Error(over); }
    if (TYPEFACE ? passSpent > TYPEFACE_CEILING : spent > PROFILE_CEILING) { await new Promise((r) => out.end(r)); throw new Error(`descriptor spend $${(TYPEFACE ? passSpent : spent).toFixed(2)} passed the $${TYPEFACE ? TYPEFACE_CEILING : PROFILE_CEILING} ceiling — stop`); }
  }
  await new Promise((r) => out.end(r));
  console.log('');
  return { need, todo: todo.length - run.length, perCall, estimate, spent, passSpent, passCalls };
}

/** Merge walk + descriptor answers into the profile and count it by language and period. */
async function profileWrite(base, date, describeInfo) {
  const answers = new Map();
  let usd = 0, calls = 0, passUsd = 0, passCalls = 0;
  const failedIds = new Set();
  for await (const d of readLines(`${base}.descriptors.jsonl`)) {
    usd += d.usd || 0; calls += d.input_tokens ? 1 : 0;
    if (d.pass === 'typeface') { passUsd += d.usd || 0; passCalls += d.input_tokens ? 1 : 0; }
    if (d.value) { answers.set(d.book_id, { value: d.value, errors: d.errors }); failedIds.delete(d.book_id); }
    else if (!answers.has(d.book_id)) failedIds.add(d.book_id);
  }
  const failed = failedIds.size;
  // Languages with fewer than LANG_MIN books are pooled as "other".
  const LANG_MIN = 200;
  const langOf = (l) => String(l || 'unknown').split(/[;,]/)[0].trim() || 'unknown';
  const langN = {};
  for await (const r of readLines(`${base}.walk.jsonl`)) langN[langOf(r.language)] = (langN[langOf(r.language)] || 0) + 1;
  const FLAGS = ['has_illustration', 'has_table', 'has_marginalia'];
  const DIMS = ['script', 'typeface', 'page_type', 'columns', ...(TYPEFACE ? FLAGS : [])];
  const PREV = 'previous page with OCR';
  // tally: every book; tallyNoPrev (--typeface): the same without the "previous page with OCR" picks.
  const tally = { all: {}, language: {}, period: {} }, tallyNoPrev = { all: {}, language: {}, period: {} };
  const sources = Object.fromEntries(DIMS.map((k) => [k, {}]));
  const picked = {}, ocr = { with_ocr: 0, without_ocr: 0 }, family = {};
  // --typeface: the descriptor's page type against the stored pages.page_type, by script family.
  const agree = {};
  let n = 0;
  const outBase = TYPEFACE ? `${base}-typeface` : base;
  const outFile = `${outBase}.jsonl`, tmp = `${outFile}.tmp`, w = fs.createWriteStream(tmp);
  for await (const r of readLines(`${base}.walk.jsonl`)) {
    const a = answers.get(r.book_id)?.value;
    const row = { ...r };
    delete row.needs_descriptor;
    if (!r.script && a?.script) {
      if (r.family === 'other') Object.assign(row, { script: a.script, script_src: 'descriptor' });
      else row.script_src = `none (descriptor said ${a.script}; not used for ${r.family}, #5623 by-eye rule)`;
    }
    if (TYPEFACE && r.page_type_src === 'pages.page_type' && a?.page_type) {
      const c = (agree[r.family] ||= { n: 0, agree: 0, pairs: {} });
      c.n++;
      if (a.page_type === r.page_type) c.agree++;
      else { const k = `stored ${r.page_type} / descriptor ${a.page_type}`; c.pairs[k] = (c.pairs[k] || 0) + 1; }
    }
    // --typeface: the descriptor's page type wins wherever it answered; otherwise inline first.
    if (a?.page_type && (TYPEFACE || !r.page_type)) Object.assign(row, { page_type: a.page_type, page_type_src: 'descriptor' });
    if (r.columns == null && a && Number.isInteger(a.columns)) Object.assign(row, { columns: a.columns, columns_src: 'descriptor' });
    Object.assign(row, a?.typeface ? { typeface: a.typeface, typeface_src: 'descriptor' } : { typeface: null, typeface_src: 'none' });
    if (a && (TYPEFACE || !row.flags)) row.flags = { has_illustration: a.has_illustration, has_table: a.has_table, has_marginalia: a.has_marginalia, src: 'descriptor' };
    else if (row.flags) row.flags.src = 'transcription tags (Gemini read)';
    if (TYPEFACE) for (const k of FLAGS) Object.assign(row, { [k]: row.flags?.[k] ?? null, [`${k}_src`]: row.flags?.[k] == null ? 'none' : row.flags.src });
    if (a) row.descriptor = a;
    if (!w.write(JSON.stringify(row) + '\n')) await new Promise((res) => w.once('drain', res));
    // counting
    n++;
    picked[r.picked] = (picked[r.picked] || 0) + 1;
    ocr[r.has_ocr ? 'with_ocr' : 'without_ocr']++;
    family[r.family] = (family[r.family] || 0) + 1;
    const vals = { script: row.script ?? 'unknown', typeface: row.typeface ?? 'unknown', page_type: row.page_type ?? 'unknown', columns: row.columns == null ? 'unknown' : row.columns >= 3 ? '3+' : String(row.columns) };
    for (const k of FLAGS) vals[k] = row[k] == null ? 'unknown' : String(row[k]);
    const lang = langN[langOf(r.language)] >= LANG_MIN ? langOf(r.language) : 'other';
    for (const k of DIMS) {
      const src = String(row[`${k}_src`]).replace(/ \(descriptor said.*$/, ' (CJK/Tibetan rule)');
      sources[k][src] = (sources[k][src] || 0) + 1;
      for (const t of TYPEFACE && r.picked !== PREV ? [tally, tallyNoPrev] : [tally]) {
        for (const [g, key] of [['all', 'all'], ['language', lang], ['period', r.period]]) {
          const cell = ((t[g][key] ||= {})[k] ||= { n: 0 });
          cell.n++; cell[vals[k]] = (cell[vals[k]] || 0) + 1;
        }
      }
    }
  }
  await new Promise((res) => w.end(res));
  fs.renameSync(tmp, outFile);
  const withCi = (cell) => Object.fromEntries(Object.entries(cell).filter(([v]) => v !== 'n').sort((x, y) => y[1] - x[1]).map(([v, k]) => { const [lo, hi] = wilson(k, cell.n); return [v, { k, share: r3(k / cell.n), ci: [r3(lo), r3(hi)] }]; }));
  const shape = (byKey) => Object.fromEntries(Object.entries(byKey).sort((x, y) => y[1].script.n - x[1].script.n).map(([key, dims]) => [key, { n: dims.script.n, ...Object.fromEntries(DIMS.map((k) => [k, withCi(dims[k])])) }]));
  const profileOf = (t) => ({ all: shape(t.all).all, by_language: shape(t.language), by_period: Object.fromEntries(PERIODS.filter((p) => t.period[p]).map((p) => [p, shape({ [p]: t.period[p] })[p]])) });
  const summary = {
    generated: date, issue: 5643, rows: n, file: path.relative(ROOT, outFile),
    unit: 'one page per visible book (visible: true, pages_count > 4): the middle page, else the next page with OCR, else the nearest before it',
    picked, ocr, script_family: family,
    sources,
    descriptor: { model: DESCRIPTOR_MODEL, prompt_version: DESCRIPTOR_VERSION, books_needing_it: describeInfo?.need ?? null, answered: answers.size, failed, calls, usd: Math.round(usd * 10000) / 10000, per_call_estimate: describeInfo?.perCall ?? null, billing: 'realtime list price through scripts/lib/gemini-script-client.mjs, thinking off',
      ...(TYPEFACE && { typeface_pass: { calls: passCalls, usd: Math.round(passUsd * 10000) / 10000, usd_per_call: passCalls ? Math.round((passUsd / passCalls) * 1e7) / 1e7 : null, ceiling: TYPEFACE_CEILING } }) },
    rules: {
      script: 'pages.script_type, else the OCR <script> tag, else the descriptor — except on CJK or Tibetan pages (by OCR text characters, else books.language), where the descriptor\'s script is not used (#5623 by-eye check) and the value is unknown',
      page_type: TYPEFACE ? 'the descriptor wherever it answered; else pages.page_type, else the OCR <page-type> tag' : 'pages.page_type, else the OCR <page-type> tag, else the descriptor',
      columns: 'pages.columns, else the OCR <columns> tag, else the descriptor',
      typeface: TYPEFACE ? 'the descriptor (no inline counterpart); unknown where it did not answer (no OCR, no image, or a failed call)' : 'the descriptor only (no inline counterpart); unknown on every page it did not run on',
      ...(TYPEFACE && { flags: 'has_illustration / has_table / has_marginalia: the descriptor wherever it answered; else the transcription tags of a Gemini read; else unknown' }),
      language: `books.language, first value; languages under ${LANG_MIN} books pooled as "other"`,
      period: 'books.published pinned to one century (periodOf in this script), else books.year, else unknown',
      intervals: 'Wilson 95% on each share within its cell',
    },
    ...profileOf(tally),
    ...(TYPEFACE && {
      without_previous_page_picks: { excluded: picked[PREV] || 0, why: `books profiled from the "${PREV}" fallback (mostly books whose OCR stops at page 25, so the page sits near the front matter)`, ...profileOf(tallyNoPrev) },
      page_type_agreement: {
        what: 'the descriptor\'s page type against the stored pages.page_type, on every book whose picked page carries one and the descriptor answered; by script family (OCR text characters, else books.language)',
        by_family: Object.fromEntries(Object.entries(agree).sort((x, y) => y[1].n - x[1].n).map(([f, c]) => { const [lo, hi] = wilson(c.agree, c.n); return [f, { n: c.n, agree: c.agree, share: r3(c.agree / c.n), ci: [r3(lo), r3(hi)], top_disagreements: Object.fromEntries(Object.entries(c.pairs).sort((x, y) => y[1] - x[1]).slice(0, 10)) }]; })),
      },
    }),
  };
  fs.writeFileSync(`${outBase}.summary.json`, JSON.stringify(summary, null, 1) + '\n');
  console.log(`profile: ${n} books → ${path.relative(ROOT, outFile)}; summary ${path.relative(ROOT, outBase)}.summary.json`);
  console.log('picked', JSON.stringify(picked), 'ocr', JSON.stringify(ocr), 'family', JSON.stringify(family));
  for (const k of DIMS) console.log(`${k}: ${JSON.stringify(Object.fromEntries(Object.entries(summary.all[k]).map(([v, c]) => [v, c.k])))}  sources ${JSON.stringify(sources[k])}`);
  console.log(`descriptor: ${answers.size} answered, ${failed} failed, ${calls} calls, $${usd.toFixed(3)}${TYPEFACE ? `; typeface pass ${passCalls} calls, $${passUsd.toFixed(3)}` : ''}`);
  if (TYPEFACE) for (const [f, c] of Object.entries(summary.page_type_agreement.by_family)) console.log(`page type agreement ${f}: ${c.agree}/${c.n} = ${c.share} [${c.ci}]`);
}

if (process.argv.includes('--corpus-profile')) {
  const date = process.argv.find((a) => a.startsWith('--date='))?.slice(7) || new Date().toISOString().slice(0, 10);
  const base = path.join(ROOT, `scripts/eval/output/corpus-page-profile-${date}`);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  await profileWalk(mongo.db('bookstore'), base);
  await mongo.close(); // no Mongo connection is held across model calls
  const info = await profileDescribe(base);
  await profileWrite(base, date, info);
  process.exit(0);
}

// ── 1. translation pages (pooling rule of quality-by-language.mjs) ─────────────
const auditDirs = fs.readdirSync(RESULTS)
  .filter((d) => d.startsWith('translation-corpus-audit-') && !d.includes('chained') && fs.existsSync(path.join(RESULTS, d, 'report.json')))
  .map((d) => ({ dir: path.join(RESULTS, d), report: JSON.parse(fs.readFileSync(path.join(RESULTS, d, 'report.json'), 'utf8')) }))
  .sort((a, b) => String(a.report.drawn_at).localeCompare(String(b.report.drawn_at)));
const tPages = new Map(); // book_id -> row
for (const { dir, report } of auditDirs) {
  if (report.controls_gate && report.controls_gate.pass === false) continue;
  const judge = report.primary_judge || 'opus';
  const verdicts = {};
  const vdir = path.join(dir, 'verdicts', judge);
  for (const f of fs.existsSync(vdir) ? fs.readdirSync(vdir).filter((x) => x.endsWith('.jsonl')) : []) for (const v of readJsonl(path.join(vdir, f))) verdicts[v.id] = v;
  const items = new Map(readJsonl(path.join(dir, 'items.jsonl')).map((it) => [it.id, it]));
  for (const m of readJsonl(path.join(dir, 'manifest.jsonl'))) {
    const v = verdicts[m.id];
    if (m.kind !== 'main' || !v || typeof v.fidelity !== 'number' || tPages.has(m.book_id)) continue;
    tPages.set(m.book_id, {
      key: `t|${m.book_id}`, audit: path.basename(dir), book_id: m.book_id, page_id: m.page_id, page_number: m.page_number,
      language: m.language, script: m.language === 'Latin' || ['English', 'German', 'French', 'Italian', 'Dutch', 'Spanish'].includes(m.language) ? 'Latin' : 'non-Latin',
      published: m.published ?? null, period: periodOf(m.published), period_draw: m.period ?? null,
      chars: contentChars(items.get(m.id)?.source), fidelity: v.fidelity, ok: v.fidelity >= 4,
    });
  }
}

// ── 2. OCR benchmark pages (file selection and reference rule of benchmark-dashboard-data.mjs) ──
const BDIR = path.join(RESULTS, 'benchmark');
const latest = new Map();
for (const f of fs.readdirSync(BDIR).filter((f) => /^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json$/.test(f) && !f.startsWith('summary-')).sort()) latest.set(f.replace(/-\d{4}-\d{2}-\d{2}\.json$/, ''), f);
const registry = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'scripts/eval/benchmark')).filter((f) => f.endsWith('.json'))) {
  const pages = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/benchmark', f), 'utf8')).pages;
  for (const p of Array.isArray(pages) ? pages : []) registry.set(p.slug, p);
}
const refusalDir = path.join(BDIR, 'refusals');
const refusalFile = fs.existsSync(refusalDir) ? fs.readdirSync(refusalDir).filter((f) => /^refusals-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1) : null;
const refusals = refusalFile ? JSON.parse(fs.readFileSync(path.join(refusalDir, refusalFile), 'utf8')) : null;
const isRefused = (stratum, slug, engine, e, isTier) => {
  if (typeof e.refused === 'boolean') return e.refused;
  const rec = refusals?.strata?.[stratum]?.[engine];
  if (rec?.meter) return !!rec.refused?.[slug] || !!rec.inferred?.includes(slug);
  return API_ENGINE.test(engine) && (isTier ? e.chars === 0 : e.n_content === 0);
};
const SCRIPT_OF = { Latin: 'Latin', English: 'Latin', French: 'Latin', Italian: 'Latin', Spanish: 'Latin', Dutch: 'Latin', German: 'Latin', Greek: 'Greek', Chinese: 'Han' };
const oPages = []; // one row per referenced page × production engine
for (const [stratum, file] of latest) {
  const j = JSON.parse(fs.readFileSync(path.join(BDIR, file), 'utf8'));
  const isTier = stratum.startsWith('ref-');
  for (const p of j.pages) {
    if (!(isTier || p.has_ref)) continue; // proxy-scored pages measure agreement, not accuracy
    const reg = registry.get(p.slug) || {};
    const engines = Object.entries(p.engines || {}).filter(([, e]) => !e.missing);
    // Characters on the page: the reference's content length where the scorer kept it (n_content,
    // equal across engines on a sealed stratum); a reference tier keeps only each engine's output
    // length, so the median over engines stands in.
    const chars = isTier ? median(engines.map(([, e]) => e.chars).filter((x) => x > 0)) : median(engines.map(([, e]) => e.n_content).filter((x) => x > 0));
    for (const [engine, e] of engines) {
      if (engine !== LITE && engine !== FLASH) continue;
      if (isTier && !e.aligned) continue; // coverage, not CER (dashboard rule)
      if (typeof e.cer !== 'number') continue;
      const refused = isRefused(stratum, p.slug, engine, e, isTier);
      oPages.push({
        key: `o|${stratum}|${p.slug}`, stratum, slug: p.slug, engine,
        book_id: reg.book_id ?? null, page_number: reg.page_number != null ? Number(reg.page_number) : null,
        language: p.language ?? reg.language ?? null,
        published: reg.published ?? (p.year ?? null), period: periodOf(reg.published, typeof p.year === 'number' ? p.year : (typeof reg.year === 'number' ? reg.year : null)),
        chars: chars ?? null, cer: refused && !isTier ? 1 : e.cer, refused,
        script: SCRIPT_OF[String(p.language ?? reg.language ?? '').split(/[;,]/)[0].trim().replace(/^Ancient /, '')] || 'other',
      });
    }
  }
}

// ── 3. resolution ─────────────────────────────────────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const oKeys = [...new Map(oPages.filter((r) => r.book_id).map((r) => [r.key, { key: r.key, book_id: r.book_id, page_number: r.page_number }])).values()];
const res = await resolutionFor(db, [...[...tPages.values()].map((r) => ({ key: r.key, page_id: r.page_id })), ...oKeys]);
for (const r of [...tPages.values(), ...oPages]) {
  const x = res.get(r.key);
  r.long_edge = x?.long_edge ?? null;
  r.res_source = x?.source ?? (r.book_id ? 'not looked up' : 'external reference scan (no Source Library page)');
  r.res_band = resBand(r.long_edge);
}

// ── 3b. manuscript, holding library, page content, format (#5623) ───────────────
const facts = await pageFacts(db, [...tPages.values()], oPages);
const descriptors = await descriptorStep(facts);
await client.close();
const pageCoverage = applyFacts([...tPages.values(), ...oPages], facts, descriptors);
const descriptorSummary = descriptorReport(facts, descriptors);

// ── 4. strata ─────────────────────────────────────────────────────────────────
const terciles = (rows) => {
  const xs = rows.map((r) => r.chars).filter((x) => x > 0).sort((a, b) => a - b);
  return [xs[Math.floor(xs.length / 3)], xs[Math.floor((2 * xs.length) / 3)]];
};
const T = [...tPages.values()];
const tCut = terciles(T);
const charLevel = (c, cut) => (!(c > 0) ? 'unknown' : c < cut[0] ? 'fewest' : c < cut[1] ? 'middle' : 'most');
for (const r of T) r.char_level = charLevel(r.chars, tCut);

// Holding libraries with fewer than PROVIDER_MIN books in a sample go into "other", within that sample.
const PROVIDER_MIN = 15;
function groupProviders(rows) {
  const n = rows.reduce((a, r) => ((a[r.provider] = (a[r.provider] || 0) + 1), a), {});
  for (const r of rows) r.provider_group = r.provider === 'unknown' ? 'unknown' : n[r.provider] >= PROVIDER_MIN ? r.provider : 'other';
  return [...Object.entries(rows.reduce((a, r) => ((a[r.provider_group] = (a[r.provider_group] || 0) + 1), a), {}))]
    .sort((a, b) => (a[0] === 'unknown') - (b[0] === 'unknown') || (a[0] === 'other') - (b[0] === 'other') || b[1] - a[1]).map(([k]) => k);
}
const T_PROVIDERS = groupProviders(T);
const O_PROVIDERS = groupProviders(oPages.filter((r) => r.engine === LITE));
for (const r of oPages) if (!r.provider_group) r.provider_group = O_PROVIDERS.includes(r.provider) ? r.provider : r.provider === 'unknown' ? 'unknown' : 'other';
const MS_ALL = [...MS_LEVELS, 'unknown'];
const crossTab = (rows, a, b) => rows.reduce((o, r) => { const x = (o[r[a]] ||= {}); x[r[b]] = (x[r[b]] || 0) + 1; return o; }, {});

// The same cell within each script class: the audits over-sample non-Latin languages, so a pooled
// cell's rate moves with its script mix as much as with the covariate.
function scriptSplit(g) {
  const o = {};
  for (const [k, sc] of [['latin', 'Latin'], ['nonlatin', 'non-Latin']]) {
    const s = g.filter((r) => r.script === sc), kk = s.filter((r) => r.ok).length, [lo, hi] = wilson(kk, s.length);
    o[k] = s.length ? { n: s.length, k: kk, rate: r3(kk / s.length), ci: [r3(lo), r3(hi)] } : null;
  }
  return o;
}
function rateCells(rows, factor, levels) {
  return levels.map((level) => {
    const g = rows.filter((r) => r[factor] === level);
    const k = g.filter((r) => r.ok).length;
    const [lo, hi] = wilson(k, g.length);
    return { level, n: g.length, k, rate: g.length ? r3(k / g.length) : null, ci: g.length ? [r3(lo), r3(hi)] : null, grade: GRADE(g.length), non_latin: g.filter((r) => r.script === 'non-Latin').length, ...scriptSplit(g) };
  }).filter((c) => c.n > 0);
}
function cerCells(rows, factor, levels, seedSalt) {
  return levels.map((level, i) => {
    const g = rows.filter((r) => r[factor] === level).map((r) => r.cer);
    const ci = g.length >= 5 ? bootstrapItems(g, median, makeRng(SEED + seedSalt * 31 + i), 2000) : null;
    return { level, n: g.length, median: r3(median(g)), ci: ci ? ci.map(r3) : null, grade: GRADE(g.length) };
  }).filter((c) => c.n > 0);
}
const CHAR_LEVELS = ['fewest', 'middle', 'most', 'unknown'];
const translation = {
  n: T.length,
  overall: rateCells(T.map((r) => ({ ...r, all: 'all' })), 'all', ['all'])[0],
  by_period: rateCells(T, 'period', PERIODS),
  by_chars: rateCells(T, 'char_level', CHAR_LEVELS).map((c) => ({ ...c, range: c.level === 'fewest' ? `<${tCut[0]}` : c.level === 'middle' ? `${tCut[0]}–${tCut[1] - 1}` : c.level === 'most' ? `≥${tCut[1]}` : null })),
  by_resolution: rateCells(T, 'res_band', RES_BANDS),
  by_manuscript: rateCells(T, 'ms', MS_ALL),
  by_provider: rateCells(T, 'provider_group', T_PROVIDERS),
  by_content: rateCells(T, 'content', CONTENT_LEVELS),
  cross: { manuscript_by_script: crossTab(T, 'ms', 'script'), manuscript_by_period: crossTab(T, 'ms', 'period'), provider_by_script: crossTab(T, 'provider_group', 'script'), provider_by_manuscript: crossTab(T, 'provider_group', 'ms'), rule_by_manuscript: crossTab(T, 'ms_rule_class', 'ms') },
  char_cuts: tCut,
  period_parse_agrees_with_draw: T.filter((r) => r.period === r.period_draw).length,
  resolution_sources: Object.fromEntries(Object.entries(T.reduce((a, r) => ((a[r.res_source] = (a[r.res_source] || 0) + 1), a), {}))),
};
const ocr = {};
for (const [name, engine] of [['lite', LITE], ['flash', FLASH]]) {
  const O = oPages.filter((r) => r.engine === engine);
  const cut = terciles(O);
  for (const r of O) r.char_level = charLevel(r.chars, cut);
  ocr[name] = {
    engine, n: O.length, refused_scored_as_1: O.filter((r) => r.refused).length,
    overall: cerCells(O.map((r) => ({ ...r, all: 'all' })), 'all', ['all'], name === 'lite' ? 1 : 2)[0],
    by_period: cerCells(O, 'period', PERIODS, name === 'lite' ? 3 : 4),
    by_chars: cerCells(O, 'char_level', CHAR_LEVELS, name === 'lite' ? 5 : 6).map((c) => ({ ...c, range: c.level === 'fewest' ? `<${cut[0]}` : c.level === 'middle' ? `${cut[0]}–${cut[1] - 1}` : c.level === 'most' ? `≥${cut[1]}` : null })),
    by_resolution: cerCells(O, 'res_band', RES_BANDS, name === 'lite' ? 7 : 8),
    by_manuscript: cerCells(O, 'ms', MS_ALL, name === 'lite' ? 41 : 42),
    by_provider: cerCells(O, 'provider_group', O_PROVIDERS, name === 'lite' ? 43 : 44),
    by_content: cerCells(O, 'content', CONTENT_LEVELS, name === 'lite' ? 45 : 46),
    cross: { manuscript_by_script: crossTab(O, 'ms', 'script'), manuscript_by_period: crossTab(O, 'ms', 'period'), provider_by_script: crossTab(O, 'provider_group', 'script') },
    char_cuts: cut,
    // Pooled cells mostly sort pages by LANGUAGE (the Chinese cohort is half the referenced pages, has
    // no catalogue date and small scans), so each script is also cut on its own, terciles within it.
    within_script: Object.fromEntries(['Latin', 'Greek', 'Han'].map((sc, si) => {
      const S = O.filter((r) => r.script === sc).map((r) => ({ ...r }));
      const sCut = terciles(S);
      for (const r of S) r.char_level = charLevel(r.chars, sCut);
      const salt = (name === 'lite' ? 10 : 20) + si * 3;
      return [sc, {
        n: S.length, char_cuts: sCut,
        by_period: cerCells(S, 'period', PERIODS, salt),
        by_chars: cerCells(S, 'char_level', CHAR_LEVELS, salt + 1).map((c) => ({ ...c, range: c.level === 'fewest' ? `<${sCut[0]}` : c.level === 'middle' ? `${sCut[0]}–${sCut[1] - 1}` : c.level === 'most' ? `≥${sCut[1]}` : null })),
        by_resolution: cerCells(S, 'res_band', RES_BANDS, salt + 2),
        by_manuscript: cerCells(S, 'ms', MS_ALL, salt + 100),
        by_provider: cerCells(S, 'provider_group', O_PROVIDERS, salt + 101),
        by_content: cerCells(S, 'content', CONTENT_LEVELS, salt + 102),
      }];
    })),
    resolution_sources: Object.fromEntries(Object.entries(O.reduce((a, r) => ((a[r.res_source] = (a[r.res_source] || 0) + 1), a), {}))),
    strata: Object.fromEntries(Object.entries(O.reduce((a, r) => ((a[r.stratum] = (a[r.stratum] || 0) + 1), a), {}))),
    by_language_n: Object.fromEntries(Object.entries(O.reduce((a, r) => ((a[r.language || 'unknown'] = (a[r.language || 'unknown'] || 0) + 1), a), {}))),
  };
}

// ── 5. logistic regression (IRLS, Wald intervals) ─────────────────────────────
// judge ≥ 4 ~ non-Latin script + period + log2(characters) + resolution band, one page per book,
// unweighted. Reference levels: Latin script, 1600s, 1500–2499 px. Unknown period and unknown
// resolution are kept as their own levels rather than dropped, so n is the whole sample.
function logistic(X, y) {
  const p = X[0].length;
  let b = new Array(p).fill(0);
  let cov = null, converged = false, iter = 0;
  for (; iter < 50; iter++) {
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    const g = new Array(p).fill(0);
    for (let i = 0; i < X.length; i++) {
      const eta = X[i].reduce((s, x, j) => s + x * b[j], 0);
      const mu = 1 / (1 + Math.exp(-eta));
      const w = mu * (1 - mu);
      for (let j = 0; j < p; j++) { g[j] += X[i][j] * (y[i] - mu); for (let k = 0; k < p; k++) H[j][k] += w * X[i][j] * X[i][k]; }
    }
    cov = invert(H);
    const step = cov.map((row) => row.reduce((s, x, k) => s + x * g[k], 0));
    b = b.map((x, j) => x + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) { converged = true; break; }
  }
  return { b, se: cov.map((row, j) => Math.sqrt(row[j])), converged, iterations: iter + 1 };
}
function invert(A) {
  const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('singular information matrix (a level with no variation?)');
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r.slice(n));
}
const R = T.filter((r) => r.chars > 0);
const baseTerms = [
  ['non-Latin script (vs Latin)', (r) => (r.script === 'non-Latin' ? 1 : 0)],
  ...['pre-1500', '1500s', '1700s', '1800s', '1900+', 'unknown'].map((pd) => [`period ${pd} (vs 1600s)`, (r) => (r.period === pd ? 1 : 0)]),
  ['log2 characters (per doubling)', (r) => Math.log2(r.chars) - Math.log2(median(R.map((x) => x.chars)))],
  ...['<1500 px', '≥2500 px', 'unknown'].map((b) => [`resolution ${b} (vs 1500–2499 px)`, (r) => (r.res_band === b ? 1 : 0)]),
];
// #5623: manuscript (the book's majority <script> tag, else the fallback rule) against print. A
// "mixed" book is its own term only with at least 10 books; with fewer it is counted with print.
const mixedN = R.filter((r) => r.ms === 'mixed').length;
const msTerms = [
  ['manuscript (vs print)', (r) => (r.ms === 'manuscript' ? 1 : 0)],
  ...(mixedN >= 10 ? [['mixed hand and print (vs print)', (r) => (r.ms === 'mixed' ? 1 : 0)]] : []),
];
const Z = 1.959964;
function fitModel(model, defs) {
  const termDefs = defs.filter(([name, f]) => name.startsWith('log2') || R.some((r) => f(r) === 1)); // an empty level has no coefficient
  const X = R.map((r) => [1, ...termDefs.map(([, f]) => f(r))]);
  const fit = logistic(X, R.map((r) => (r.ok ? 1 : 0)));
  return {
    model, n: R.length, events: R.filter((r) => r.ok).length, converged: fit.converged, iterations: fit.iterations,
    terms: termDefs.map(([name, f], j) => {
      const bj = fit.b[j + 1], se = fit.se[j + 1];
      return { term: name, n_at_level: name.startsWith('log2') ? null : R.filter((r) => f(r) === 1).length, odds_ratio: r3(Math.exp(bj)), ci: [r3(Math.exp(bj - Z * se)), r3(Math.exp(bj + Z * se))], p: r3(2 * (1 - normCdf(Math.abs(bj / se)))) };
    }),
  };
}
const regression = {
  ...fitModel('logit P(judge ≥ 4) = script + manuscript + period + log2(chars) + resolution band; IRLS, Wald 95% CI; one page per book, unweighted', [baseTerms[0], ...msTerms, ...baseTerms.slice(1)]),
  mixed_counted_as_print: mixedN >= 10 ? 0 : mixedN,
};
const regressionWithoutManuscript = fitModel('logit P(judge ≥ 4) = script + period + log2(chars) + resolution band (the #5615 model, for comparison)', baseTerms);
function normCdf(z) { const t = 1 / (1 + 0.2316419 * z); const d = 0.3989423 * Math.exp((-z * z) / 2); return 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); }

// ── 6. write ──────────────────────────────────────────────────────────────────
const out = {
  generated: new Date().toISOString().slice(0, 10),
  issue: 5615,
  issues: [5615, 5623],
  seed: SEED,
  status: 'exploratory and observational: no covariate was randomised, the audits were stratified by language, and every cell under 30 is a first look',
  sources: {
    translation: auditDirs.map((a) => path.relative(ROOT, a.dir)),
    ocr: [...latest.values()].map((f) => `scripts/eval/results/benchmark/${f}`),
    refusals: refusalFile ? `scripts/eval/results/benchmark/refusals/${refusalFile}` : null,
    resolution: 'bookstore.pages image_width/image_height; else the crop or archived image header on images.sourcelibrary.org',
    manuscript: 'bookstore.pages ocr.data <script> tags (every OCR\'d page of the book, counted in Mongo); scripts/eval/output/page-descriptors-5623.json where the sampled page has none; else routeBook() in scripts/lib/syriac-kraken-lane.mjs',
    provider: 'bookstore.books image_source.provider; else the image host',
    content: 'the Gemini transcription\'s own tags (<page-type>, <margin>, markdown tables, <detected-images>/<image-desc>); else the descriptor',
  },
  definitions: {
    unit: 'one page per book (audits pool monthly draws with each book counted once, its earliest verdict; the OCR benchmark draws one page per book per stratum)',
    period: 'From books.published (free text) when it pins one century: a single year, a range inside one century, "Nth century", "14uu". Cross-century ranges, BCE dates and Roman numerals are unknown. OCR pages fall back to the registry year. Catalogue date: for a reprint it is the work\'s date, not the scan\'s.',
    chars: 'Non-space characters of the served transcription with its structural tags removed (translation); the reference text\'s content length, or the engines\' median output length on reference tiers (OCR). Terciles are cut within each sample. A CJK page carries far fewer characters than a Latin page of the same area, so the lowest tercile is mostly non-Latin.',
    resolution: 'Long edge in pixels of the stored master scan (or of the crop for a split page). Not the reader\'s display copy, which is capped at 2,000 px wide. OCR reference-tier pages (Wikisource, pinned editions) are external scans with no Source Library page and are unknown.',
    judge: 'Claude Opus fidelity rating 4 or 5 of 5, source-grounded. A model judgement, not accuracy.',
    cer: 'Character error rate against a published e-text, median per stratum, refusals scored as 1.0 on sealed strata (the dashboard rule). 95% percentile bootstrap, 2,000 resamples, seeded.',
    manuscript: 'Book level. The majority of the OCR <script> tag (printed | handwritten | mixed) over every OCR\'d page of the book, with the sampled page\'s descriptor answer counted when its own tag is absent; a tie is mixed. A book with no tag at all takes the Syriac lane\'s routing rule (scripts/lib/syriac-kraken-lane.mjs routeBook): held by a manuscript library (vatican, cambridge, bodleian, manchester, chester_beatty, gallica, bl) or published before 1500 is manuscript, anything else print. That rule was written for Syriac; gallica and bl hold mostly print outside it. coverage.*.ms_rule counts which rule decided each book.',
    provider: 'The holding library or scan source from books.image_source.provider (mdz merged into bsb: the same library). A library with fewer than 15 books in a sample is "other" within that sample.',
    content: 'One class per page, the first that applies: illustration (page type illustration, diagram, map or frontispiece, or a detected image), table (page type table or a markdown table), marginalia (a <margin> note), else plain text. From the transcription\'s tags when the page was read by Gemini with the tagged prompt (absence of a <margin> tag there means none seen); otherwise from the image-only descriptor. The audits exclude plates and blanks, so illustration and table are rare there by design.',
    format: 'books.format (2°, 4°, 8°) is filled on too few sampled books for a 30-per-cell comparison; see format.',
    intervals: 'Rates: Wilson 95%. Medians: percentile bootstrap 95%. Grades: under 30 exploratory, 30–49 directional, 50 or more decision-grade.',
  },
  translation,
  ocr,
  regression,
  regression_without_manuscript: regressionWithoutManuscript,
  coverage: pageCoverage,
  format: (() => {
    const cells = (k) => Object.entries(pageCoverage[k].format).filter(([f]) => f !== 'null').map(([f, n]) => ({ level: f, n }));
    const tc = cells('translation'), oc = cells('ocr_lite');
    const usable = [...tc, ...oc].some((c) => c.n >= 30) && tc.every((c) => c.n >= 30);
    return { skipped: !usable, reason: usable ? null : `books.format is set on ${tc.reduce((s, c) => s + c.n, 0)} of ${T.length} audited books and ${oc.reduce((s, c) => s + c.n, 0)} of ${pageCoverage.ocr_lite.n} benchmark pages; no cell reaches 30`, translation: tc, ocr_lite: oc };
  })(),
  descriptor: descriptorSummary,
  // How the Syriac lane's fallback rule (provider or date) scores against the book's tag/descriptor
  // label, on the audited books where a tag or descriptor answer exists.
  fallback_rule_check: (() => {
    const rows = T.filter((r) => r.ms_fallback && r.ms !== 'mixed');
    const tab = crossTab(rows, 'ms', 'ms_fallback');
    return { n: rows.length, agree: rows.filter((r) => r.ms === r.ms_fallback).length, label_by_fallback: tab };
  })(),
};
fs.writeFileSync(path.join(ROOT, 'src/data/quality-covariates.json'), JSON.stringify(out, null, 2) + '\n');

const show = (title, cells, f) => { console.log(`\n${title}`); for (const c of cells) console.log(`  ${String(c.level).padEnd(14)} n=${String(c.n).padStart(4)}  ${f(c)}  ${c.grade}`); };
console.log(`translation: ${T.length} books; period parse agrees with the draw on ${translation.period_parse_agrees_with_draw}; resolution sources ${JSON.stringify(translation.resolution_sources)}`);
show('judge ≥4 by period', translation.by_period, (c) => `${c.rate} [${c.ci}] nonLatin=${c.non_latin}`);
show(`judge ≥4 by chars (cuts ${tCut})`, translation.by_chars, (c) => `${c.rate} [${c.ci}] nonLatin=${c.non_latin}`);
show('judge ≥4 by resolution', translation.by_resolution, (c) => `${c.rate} [${c.ci}] nonLatin=${c.non_latin}`);
for (const k of ['lite', 'flash']) {
  console.log(`\nOCR ${k}: ${ocr[k].n} pages, refused ${ocr[k].refused_scored_as_1}, strata ${JSON.stringify(ocr[k].strata)}`);
  show('  CER by period', ocr[k].by_period, (c) => `${c.median} [${c.ci}]`);
  show(`  CER by chars (cuts ${ocr[k].char_cuts})`, ocr[k].by_chars, (c) => `${c.median} [${c.ci}]`);
  show('  CER by resolution', ocr[k].by_resolution, (c) => `${c.median} [${c.ci}]`);
  console.log('  resolution sources', JSON.stringify(ocr[k].resolution_sources));
  for (const [sc, w] of Object.entries(ocr[k].within_script)) {
    console.log(`  -- ${sc}: n=${w.n} cuts ${w.char_cuts}`);
    for (const f of ['by_period', 'by_chars', 'by_resolution']) console.log(`     ${f}: ` + w[f].map((c) => `${c.level} ${c.median} [${c.ci}] n=${c.n}`).join(' | '));
  }
}
for (const f of ['by_period', 'by_chars', 'by_resolution']) console.log(`translation ${f} within script: ` + translation[f].map((c) => `${c.level} L ${c.latin?.k}/${c.latin?.n} N ${c.nonlatin?.k}/${c.nonlatin?.n}`).join(' | '));
for (const f of ['by_manuscript', 'by_provider', 'by_content']) {
  show(`judge ≥4 ${f}`, translation[f], (c) => `${c.rate} [${c.ci}] L ${c.latin?.k}/${c.latin?.n} N ${c.nonlatin?.k}/${c.nonlatin?.n}`);
  for (const [sc, w] of Object.entries(ocr.lite.within_script)) console.log(`   lite ${sc} ${f}: ` + w[f].map((c) => `${c.level} ${c.median} [${c.ci}] n=${c.n}`).join(' | '));
}
console.log('\ncross translation', JSON.stringify(translation.cross));
console.log('cross ocr lite', JSON.stringify(ocr.lite.cross));
console.log('coverage', JSON.stringify(pageCoverage));
console.log('format', JSON.stringify(out.format));
console.log('descriptor', JSON.stringify(descriptorSummary.agreement_with_inline_tags));
console.log('descriptor on hands', JSON.stringify(descriptorSummary.agreement_on_handwritten_or_mixed_tags));
console.log('fallback rule check', JSON.stringify(out.fallback_rule_check));
console.log(`\nregression n=${regression.n} events=${regression.events} converged=${regression.converged}`);
for (const t of regression.terms) console.log(`  ${t.term.padEnd(38)} OR ${t.odds_ratio} [${t.ci}] p=${t.p} n=${t.n_at_level}`);
console.log('without manuscript:');
for (const t of regressionWithoutManuscript.terms.slice(0, 1)) console.log(`  ${t.term.padEnd(38)} OR ${t.odds_ratio} [${t.ci}] p=${t.p} n=${t.n_at_level}`);
