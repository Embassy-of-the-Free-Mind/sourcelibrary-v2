#!/usr/bin/env node
// PRIOR ART: scripts/eval/spot-check/draw.mjs — uniform per book over the whole public library, one run of 3
// CONSECUTIVE pages; no strata, so it cannot fill an era × hand cell of 8 books (pre-1450 Latin is ~1% of the
// frame). scripts/eval/confidence-7866/frame.mjs draws by route/confidence cell, not by date. Reused here, not
// copied: makeRng (lib/paired-stats.mjs), bookOrder + pageImageUrl (spot-check/lib.mjs), bookHand
// (lib/ocr-trust-gate.mjs, the hand from pages.script_type), words() (route-judge-6740/defect-rate.mjs).
/**
 * Why Latin struggles (#7947), stage 1: a model-free stratified draw of live Latin books by era × hand,
 * 3 pages per book at 25/50/75% of the translated pages, and review packets of 5 books (15 pages).
 *
 *   node --env-file=.env.production.local scripts/eval/latin-strata-7947/draw.mjs --out <dir> [--seed 20261102] [--per-cell 8]
 *
 * Frame: visible, pages_count > 0, language /^(Latin|lat)$/i, pages_translated >= 3 (the counter; the page
 * read below verifies >= 3 pages carry BOTH OCR and English).
 * Era: the first 4-digit run of `published`; failing that "Nth century" → its midpoint (recorded as
 * year_rule: 'century'); else 'unknown' (its own row).
 * Hand: bookHand() over the book's pages.script_type profile (OCR's own <script> tag). A book with too few tagged
 * pages is 'unknown' there and takes its era's default (manuscript before 1450, print after), flagged
 * hand_rule: 'era-default'. Reviewers confirm form on the image; the analysis uses the confirmed form.
 * Writes: sample.json, packets/packet-N.json, draw-log.json, cells.json (frame AND all-live-Latin counts per cell).
 * Read-only on Mongo. No model calls.
 */
import { MongoClient } from 'mongodb';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
import { bookOrder, pageImageUrl } from '../spot-check/lib.mjs';
import { bookHand } from '../../lib/ocr-trust-gate.mjs';
import { words } from '../route-judge-6740/defect-rate.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out');
const SEED = Number(opt('seed', 20261102));
const PER_CELL = Number(opt('per-cell', 8));
const PER_PACKET = 5;
const QUANTILES = [0.25, 0.5, 0.75];
const MIN_WORDS = 40; // below this a page is a plate, a blank or a title leaf: skipped for the next one out
if (!OUT) throw new Error('--out required');
if (existsSync(join(OUT, 'sample.json'))) throw new Error(`${OUT}/sample.json exists — refusing to draw over a run`);

export const ERAS = ['pre-1450', '1450-1500', '1501-1550', '1551-1600', '1601-1700', '1701+', 'unknown'];
export function yearOf(published) {
  const s = String(published ?? '');
  const m = /\d{4}/.exec(s);
  if (m) return { year: Number(m[0]), rule: '4-digit' };
  const c = /\b(\d{1,2})(?:st|nd|rd|th)\s+(?:century|cent\.?|c\.)/i.exec(s) || /\b(?:s\.|saec\.?|saeculum)\s*([IVX]+)\b/i.exec(s);
  if (c) {
    const n = /^\d+$/.test(c[1]) ? Number(c[1]) : roman(c[1]);
    if (n >= 5 && n <= 20) return { year: (n - 1) * 100 + 50, rule: 'century' };
  }
  return { year: null, rule: 'none' };
}
function roman(r) {
  const v = { I: 1, V: 5, X: 10 }; let t = 0;
  for (let i = 0; i < r.length; i++) { const a = v[r[i].toUpperCase()], b = v[r[i + 1]?.toUpperCase()] ?? 0; t += a < b ? -a : a; }
  return t;
}
export function eraOf(year) {
  if (year == null) return 'unknown';
  if (year < 1450) return 'pre-1450';
  if (year <= 1500) return '1450-1500';
  if (year <= 1550) return '1501-1550';
  if (year <= 1600) return '1551-1600';
  if (year <= 1700) return '1601-1700';
  return '1701+';
}
/** Abbreviation marks a transcription kept: combining macron/tilde/overline, Latin abbreviation letters, Tironian et. */
const ABBR = /[̃̄̅ͣ-ͯꜰ-ꟿ⁊ᷓ-᷵ĀāĒēĪīŌōŪūȲȳẼẽĨĩŨũÕõÑñ]/gu;
export const abbrPer100 = (t, w) => (w ? +(100 * ((String(t).match(ABBR) || []).length) / w).toFixed(2) : 0);
const longS = (t) => (String(t).match(/ſ/g) || []).length;

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const LIVE_LATIN = { visible: true, pages_count: { $gt: 0 }, language: { $regex: /^(Latin|lat)$/i } };
const all = await db.collection('books').find(LIVE_LATIN, {
  projection: { _id: 0, id: 1, published: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 },
}).toArray();
console.log(`live Latin books: ${all.length}`);

// Hand profile for every live Latin book with >= 3 OCR'd pages (the others cannot carry one): server-side counts.
const profiled = all.filter((b) => (b.pages_ocr ?? 0) >= 3 && b.id);
const profile = new Map();
for (let i = 0; i < profiled.length; i += 400) {
  const ids = profiled.slice(i, i + 400).map((b) => b.id);
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: ids }, page_number: { $gt: 0 }, script_type: { $in: ['printed', 'handwritten', 'mixed'] } } },
    { $group: { _id: { b: '$book_id', s: '$script_type' }, n: { $sum: 1 } } },
  ], { allowDiskUse: true }).toArray();
  for (const r of rows) { const p = profile.get(r._id.b) ?? {}; p[r._id.s] = r.n; profile.set(r._id.b, p); }
  if (i % 4000 === 0) console.log(`  profiles ${i}/${profiled.length}`);
}

const cellOf = (b) => {
  const { year, rule } = yearOf(b.published);
  const era = eraOf(year);
  const measured = bookHand(profile.get(b.id));
  const hand = measured !== 'unknown' ? measured : era === 'pre-1450' ? 'manuscript' : 'print';
  return { year, year_rule: rule, era, hand, hand_rule: measured !== 'unknown' ? 'pages' : 'era-default', cell: `${era}|${hand}` };
};
const cells = {};
const frame = [];
for (const b of all) {
  const c = cellOf(b);
  b._c = c;
  const k = c.cell;
  cells[k] ??= { era: c.era, hand: c.hand, live_books: 0, live_pages: 0, live_pages_ocr: 0, live_pages_translated: 0, hand_from_pages: 0, frame_books: 0, frame_pages_translated: 0 };
  const x = cells[k];
  x.live_books++; x.live_pages += b.pages_count ?? 0; x.live_pages_ocr += b.pages_ocr ?? 0; x.live_pages_translated += b.pages_translated ?? 0;
  if (c.hand_rule === 'pages') x.hand_from_pages++;
  if ((b.pages_translated ?? 0) >= 3 && b.id) { x.frame_books++; x.frame_pages_translated += b.pages_translated; frame.push(b); }
}
console.log('cells', Object.entries(cells).map(([k, v]) => `${k}:${v.frame_books}`).join(' '));

/** Pages with both OCR and English, page_number > 0, with OCR length — no text fetched. */
async function eligible(id) {
  return db.collection('pages').aggregate([
    { $match: { book_id: id, page_number: { $gt: 0 }, 'ocr.data': { $regex: '\\S' }, 'translation.data': { $regex: '\\S' } } },
    { $project: { _id: 0, page_number: 1, len: { $strLenCP: { $ifNull: ['$ocr.data', ''] } } } },
    { $sort: { page_number: 1 } },
  ]).toArray();
}
/** 25/50/75% of the translated pages; step outward from each target past plates/blanks (OCR < MIN_WORDS words). */
async function pickPages(id) {
  const el = await eligible(id);
  if (el.length < 3) return null;
  const chosen = [];
  for (const q of QUANTILES) {
    const t = Math.round(q * (el.length - 1));
    for (let d = 0; d < el.length; d++) {
      let hit = null;
      for (const j of [t + d, t - d]) {
        if (j < 0 || j >= el.length || chosen.includes(el[j].page_number) || el[j].len < MIN_WORDS * 4) continue;
        const p = await db.collection('pages').findOne({ book_id: id, page_number: el[j].page_number }, { projection: { 'ocr.data': 1 } });
        if (words(p?.ocr?.data ?? '') >= MIN_WORDS) { hit = el[j].page_number; break; }
      }
      if (hit != null) { chosen.push(hit); break; }
    }
  }
  return chosen.length === 3 ? { pages: chosen.sort((a, b) => a - b), eligible: el.length } : null;
}

const byCell = {};
for (const b of frame) (byCell[b._c.cell] ??= []).push(b.id);
const order = Object.keys(byCell).sort((a, b) => ERAS.indexOf(a.split('|')[0]) - ERAS.indexOf(b.split('|')[0]) || a.localeCompare(b));
const picks = [];
const rejected = {};
for (const k of order) {
  const rng = makeRng(SEED ^ [...k].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7));
  let got = 0;
  for (const id of bookOrder(byCell[k], rng)) {
    if (got >= PER_CELL) break;
    const pk = await pickPages(id);
    if (!pk) { (rejected[k] ??= []).push(id); continue; }
    picks.push({ id, cell: k, ...pk });
    got++;
  }
  console.log(`  ${k}: drew ${got} of ${byCell[k].length}`);
}

const sample = [];
for (const [i, pk] of picks.entries()) {
  const b = await db.collection('books').findOne({ id: pk.id }, {
    projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, place_published: 1, publisher: 1,
      pages_count: 1, pages_ocr: 1, pages_translated: 1, 'catalog_metadata.collections': 1, 'image_source.provider': 1, ia_identifier: 1 },
  });
  const c = frame.find((f) => f.id === pk.id)._c;
  const ps = await db.collection('pages').find({ book_id: pk.id, page_number: { $in: pk.pages } }).sort({ page_number: 1, _id: 1 }).toArray();
  const out = ps.map((p) => {
    const ocr = p.ocr?.data ?? '';
    const w = words(ocr);
    return {
      page_number: p.page_number, page_id: String(p._id), position: +(pk.pages.indexOf(p.page_number) >= 0 ? QUANTILES[pk.pages.indexOf(p.page_number)] : 0),
      image_url: pageImageUrl(p),
      crop: !p.split_from_spread && !p.cropped_photo && p.crop?.xStart !== undefined ? p.crop : undefined,
      ocr, ocr_engine: p.ocr?.source ?? null, ocr_model: p.ocr?.model ?? null,
      translation: p.translation?.data ?? '', translation_model: p.translation?.model ?? null, translation_source: p.translation?.source ?? null,
      page_script_type: p.script_type ?? null, words: w, abbr_per_100_words: abbrPer100(ocr, w), long_s: longS(ocr),
    };
  });
  sample.push({
    slot: i + 1, book_id: pk.id, book_url: `https://sourcelibrary.org/book/${pk.id}`, tradition: null,
    cell: pk.cell, era: c.era, hand_drawn: c.hand, hand_rule: c.hand_rule, year: c.year, year_rule: c.year_rule,
    book: b, structure: { eligible_pages: pk.eligible }, run: pk.pages, pages: out,
  });
  console.log(String(i + 1).padStart(2), pk.cell.padEnd(22), pk.id, `p${pk.pages.join(',')}`, String(b.title).slice(0, 50));
}
await client.close();

mkdirSync(join(OUT, 'packets'), { recursive: true });
writeFileSync(join(OUT, 'sample.json'), JSON.stringify(sample, null, 1));
// Packets interleave cells (slot order is by cell), so one reviewer's bias does not sit on one cell.
const shuffled = [...sample];
const prng = makeRng(SEED + 1);
for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(prng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
const strip = (s) => ({ slot: s.slot, book_id: s.book_id, book_url: s.book_url, tradition: null, book: s.book, structure: s.structure, run: s.run,
  pages: s.pages.map(({ position, page_script_type, words: w, abbr_per_100_words, long_s, ...p }) => p) });
for (let k = 0; k * PER_PACKET < shuffled.length; k++) {
  writeFileSync(join(OUT, 'packets', `packet-${k + 1}.json`), JSON.stringify(shuffled.slice(k * PER_PACKET, (k + 1) * PER_PACKET).map(strip), null, 1));
}
writeFileSync(join(OUT, 'cells.json'), JSON.stringify({ note: 'live = visible && pages_count > 0 && language Latin; frame = live && pages_translated >= 3. Hand from pages.script_type where >= 3 pages are tagged, else the era default.', cells }, null, 1));
writeFileSync(join(OUT, 'draw-log.json'), JSON.stringify({
  issue: 7947, seed: SEED, per_cell: PER_CELL, quantiles: QUANTILES, min_words: MIN_WORDS, live_latin: all.length, frame: frame.length,
  hand_profiled_books: profiled.length, frame_by_cell: Object.fromEntries(order.map((k) => [k, byCell[k].length])), rejected,
  n_books: sample.length, n_pages: sample.reduce((s, b) => s + b.pages.length, 0),
}, null, 1));
console.log(`wrote ${OUT}: ${sample.length} books`);
