#!/usr/bin/env node
// PRIOR ART: bench2-export.mjs — exports the PINNED ground-truth pages (a fixed 56-page set
// chosen for reference coverage); it cannot draw a fresh one-page-per-book sample from a
// language stratum. lib/sampling.mjs `sampleOnePagePerBook` draws with `$sample`, which is
// not reproducible from a seed. PREREGISTRATION-per-language-ocr-suitability.md fixes the
// draw rule (Mulberry32 over the sorted id list, interior 10–90% page) but has no script.
// This is that script, writing the #4735 registry shape.
/**
 * benchmark-seal.mjs — draw and SEAL the per-stratum page sets for the standing OCR
 * benchmark (#4735), one page per book, fixed seed, and export the images every engine
 * will read (identical input for API and self-hosted arms).
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/benchmark-seal.mjs --stratum=chinese [--out=/path/images] [--dry]
 *   node scripts/eval/benchmark-seal.mjs --all --out=/path/images
 *
 * Writes scripts/eval/benchmark/<stratum>.json (the registry entry: page ids, draw rule,
 * seed, seal date, reference source per page — never overwritten once sealed unless
 * --reseal) and <out>/<stratum>/<slug>.jpg + manifest.json.
 *
 * Strata are defined below with the issue that preregistered each. Books are drawn from
 * the sorted id list with a Mulberry32 PRNG seeded by the issue number, so the draw is
 * reproducible from this file alone; the page is drawn uniformly from the interior
 * 10–90% of the book. A page is skipped (next draw, same book, up to 6 tries) when it has
 * no usable image (getPageSource) or its stored OCR shows fewer than MIN_LETTERS letters
 * (a plate or blank). Books with no stored OCR are accepted blind — the engines decide.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv, connect, disconnect } from './lib/sampling.mjs';
import { fetchImage } from './lib/runners.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const REG_DIR = path.join(__dirname, 'benchmark');
const MAX_WIDTH = parseInt(args.width || '2400', 10);   // production/Yigdzin downscale
const MIN_LETTERS = 120;
const SPARES = 4;   // per sub-stratum, drawn in the same order after the n sealed pages

// ── PRNG (Mulberry32, same as the per-language preregistration) ────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const yearOf = s => { const m = String(s || '').match(/\b(1[4-9]\d\d)\b/); return m ? +m[0] : null; };
const inRange = (lo, hi) => b => { const y = yearOf(b.published); return y != null && y >= lo && y < hi; };
const MS_RE = /manuscript|\bMS\b|codex|palimpsest|lectionary|\bmss\b/i;

// ── Strata ─────────────────────────────────────────────────────────
// Each sub-stratum: {name, n, filter (Mongo on books), pick (JS predicate on the book)}.
// `columns` requests that many of the n pages come from pages whose stored OCR carries a
// multi-column tag (#4800 asks for ≥5 multi-column pages per Latin stratum).
const ZH = { language: /^(Chinese|Classical Chinese|Literary Chinese)$/i, pages_count: { $gt: 5 } };
const BUDDHIST_RE = /佛|般若|菩薩|陀羅尼|華嚴|法華|楞嚴|楞伽|金剛|阿含|大藏|禪|涅槃|起信|淨土|地藏|藥師|觀音|sutra|sūtra/;
// Wenyuange Siku Quanshu volumes as imported: no contributing library and a "(vol N)" title
// suffix (13,117 Chinese books on 2026-09-18, 11,980 of them this shape). They are regular-script
// BRUSH MANUSCRIPT, not woodblock print — a different class for any engine decision.
const isSkqs = b => !b.contributing_library && /\(vol \d+\)/.test(b.title || '');
// Exact Kanripo catalogue title (KR-Catalog, fetched by the specialist run into
// ~/.claude/jobs/417569c5/tmp/refs/kanripo; --kanripo-catalog=<dir> to point elsewhere). Without
// the catalogue the woodblock-canon draw falls back to Buddhist titles only, and says so.
const KANRIPO_DIR = args['kanripo-catalog'] || path.join(process.env.HOME || '', '.claude/jobs/417569c5/tmp/refs/kanripo');
let kanripoTitles = null;
function kanripoExact(title) {
  if (kanripoTitles === null) {
    kanripoTitles = new Set();
    if (fs.existsSync(KANRIPO_DIR)) {
      for (const f of fs.readdirSync(KANRIPO_DIR).filter(f => /^KR\d[a-z]\.txt$/.test(f))) for (const line of fs.readFileSync(path.join(KANRIPO_DIR, f), 'utf8').split('\n')) { const m = line.match(/^\*\*\* (KR\w+) (.+)$/); if (m) kanripoTitles.add(m[2].split('-')[0].trim()); }
      console.log(`  kanripo catalogue: ${kanripoTitles.size} titles`);
    } else console.log(`  ! kanripo catalogue not found at ${KANRIPO_DIR} — woodblock-canon draws Buddhist titles only`);
  }
  const base = String(title || '').split('·')[0].split('(')[0].split(' ')[0].replace(/[（(].*$/, '').trim();
  return base.length >= 2 && kanripoTitles.has(base);
}
// Book ids already sealed in another stratum's registry (so an extension never re-draws them).
const sealedBooks = (name) => { const f = path.join(__dirname, 'benchmark', `${name}.json`); return new Set(fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).pages.map(p => p.book_id) : []); };
export const STRATA = {
  chinese: { issue: 4743, seed: 4743, subs: [
    { name: 'buddhist-canon', n: 20, filter: { ...ZH, title: BUDDHIST_RE }, reference: 'CBETA (full-text search, cbdata.dila.edu.tw)' },
    { name: 'other', n: 20, filter: ZH, pick: b => !BUDDHIST_RE.test(b.title || ''), reference: 'Kanripo where the title is catalogued, else agreement' },
  ] },
  greek: { issue: 4744, seed: 4744, subs: [
    { name: 'pre-1700-print', n: 20, filter: { language: /^(Greek|Ancient Greek|grc|gre)$/i, pages_count: { $gt: 5 } }, pick: b => inRange(1450, 1700)(b) && !MS_RE.test(b.title || ''), reference: 'First1KGreek / Perseus where the work is held, else agreement' },
    { name: '19th-c-print', n: 10, filter: { language: /^(Greek|Ancient Greek|grc|gre)$/i, pages_count: { $gt: 5 } }, pick: b => inRange(1800, 1900)(b) && !MS_RE.test(b.title || ''), reference: 'same' },
  ] },
  japanese: { issue: 4745, seed: 4745, subs: [
    { name: 'pre-1868', n: 30, filter: { language: /^Japanese/i, pages_count: { $gt: 3 } }, pick: inRange(1500, 1868), reference: 'agreement + invention (no aligned e-text); NDL tsugidigi where the item is NDL-held' },
    { name: 'meiji-and-later', n: 10, filter: { language: /^Japanese/i, pages_count: { $gt: 3 } }, pick: inRange(1868, 1950), reference: 'Aozora Bunko where the text exists, else agreement' },
  ] },
  // Extension (2026-09-15, approved on #4745's cap): NDL classical OCR v3 read the sealed kuzushiji
  // pages where neither Gemini arm did, so the pre-1868 arm is extended to a real n for the 21K-page
  // routing decision. Same rule, its own seed, books already in japanese.json excluded.
  'japanese-ext': { issue: 4745, seed: 47451, subs: [
    { name: 'pre-1868-ext', n: 120, spares: 10, filter: { language: /^Japanese/i, pages_count: { $gt: 3 } }, pick: b => inRange(1500, 1868)(b) && !sealedBooks('japanese').has(b.id), reference: 'agreement + invention (no aligned e-text); NDL v3 vs both Gemini arms' },
  ] },
  // Extension (2026-09-18, #4925 step 1): the 40-page Chinese cell has 28 referenced books; the
  // Paddle cost-lane decision (#4743) needs ≥ 50 per CLASS, and the sealed cell mixes two classes
  // the catalogue does not separate — Siku Quanshu volumes are brush manuscript (≈ 90 % of our
  // Chinese books by count), the Buddhist-canon and library scans are woodblock print. Two
  // sub-strata, each drawn only from books a canon e-text can reference (Kanripo's SKQS witness;
  // CBETA for Buddhist titles; Kanripo exact catalogue title otherwise), because a page without a
  // reference cannot enter the cell (#4925 rule). Classified by eye after export
  // (observed_class: manuscript | woodblock | movable-type | modern-typeset).
  'chinese-ext': { issue: 4925, seed: 47431, subs: [
    { name: 'skqs-manuscript', n: 40, spares: 8, filter: ZH, pick: b => isSkqs(b) && !sealedBooks('chinese').has(b.id), reference: 'Kanripo (SKQS witness, catalogue title + juan)' },
    { name: 'woodblock-canon', n: 40, spares: 8, filter: ZH, pick: b => !isSkqs(b) && !sealedBooks('chinese').has(b.id) && (BUDDHIST_RE.test(b.title || '') || kanripoExact(b.title)), reference: 'CBETA (full-text search) for Buddhist titles, else Kanripo (exact catalogue title)' },
  ] },
  syriac: { issue: 4746, seed: 4746, subs: [
    { name: 'manuscript', n: 10, filter: { language: /syriac|^syc$/i, pages_count: { $gt: 3 } }, pick: b => { const y = yearOf(b.published); return y == null || y < 1500; }, reference: 'agreement + invention' },
    { name: 'print', n: 10, filter: { language: /syriac|^syc$/i, pages_count: { $gt: 3 } }, pick: inRange(1700, 1990), reference: 'Digital Syriac Corpus / Peshitta where the text exists, else agreement' },
  ] },
  armenian: { issue: 4746, seed: 4746, subs: [
    { name: 'manuscript', n: 6, filter: { language: /armenian/i, pages_count: { $gt: 3 } }, pick: b => { const y = yearOf(b.published); return (y == null || y < 1600) && !/Zohrab|Astuatsashunch/i.test(b.title || ''); }, reference: 'agreement + invention' },
    { name: '17th-18th-c-print', n: 7, filter: { language: /armenian/i, pages_count: { $gt: 3 } }, pick: inRange(1600, 1800), reference: 'agreement + invention (TITUS where the work is held)' },
    { name: '19th-20th-c-print', n: 7, filter: { language: /armenian/i, pages_count: { $gt: 3 } }, pick: inRange(1800, 1990), reference: 'TITUS / existing ground-truth where the work is held, else agreement' },
  ] },
  'latin-pre1700': { issue: 4800, seed: 4800, subs: [
    { name: 'latin-1450-1699', n: 20, columns: 5, filter: { language: /^(Latin|lat)$/i, pages_count: { $gt: 5 } }, pick: b => inRange(1450, 1700)(b) && !MS_RE.test(b.title || ''), reference: 'agreement + invention; e-text where the work is held' },
  ] },
  'latin-1700s': { issue: 4800, seed: 4801, subs: [
    { name: 'latin-1700-1799', n: 20, columns: 5, filter: { language: /^(Latin|lat)$/i, pages_count: { $gt: 5 } }, pick: b => inRange(1700, 1800)(b) && !MS_RE.test(b.title || ''), reference: 'agreement + invention; e-text where the work is held' },
  ] },
  'german-fraktur': { issue: 4800, seed: 4802, subs: [
    { name: 'german-1500-1899', n: 20, columns: 5, filter: { language: /^(German|ger|deu)$/i, pages_count: { $gt: 5 } }, pick: b => inRange(1500, 1900)(b) && !MS_RE.test(b.title || ''), reference: 'agreement + invention; Fraktur vs Antiqua recorded by eye after export' },
  ] },
  'longs-en-fr': { issue: 4800, seed: 4803, subs: [
    { name: 'english-1600-1779', n: 10, columns: 3, filter: { language: /^(English|eng)$/i, pages_count: { $gt: 5 } }, pick: b => inRange(1600, 1780)(b) && !MS_RE.test(b.title || ''), reference: 'agreement + invention' },
    { name: 'french-1600-1779', n: 10, columns: 2, filter: { language: /^(French|fre|fra)$/i, pages_count: { $gt: 5 } }, pick: b => inRange(1600, 1780)(b) && !MS_RE.test(b.title || ''), reference: 'agreement + invention' },
  ] },
};

const letters = s => ((s || '').match(/\p{L}/gu) || []).length;
const stripTags = s => (s || '').replace(/<[^>]+>/g, ' ');
const COLUMNS_RE = /<columns>\s*([2-9])/i;

async function drawSub(db, stratum, sub, rand) {
  const proj = { id: 1, title: 1, published: 1, contributing_library: 1, pages_count: 1, language: 1, 'image_source.provider': 1 };
  let books = await db.collection('books').find(sub.filter, { projection: proj, maxTimeMS: 180000 }).toArray();
  books = books.filter(b => b.id && (b.pages_count || 0) > 5);
  if (sub.pick) books = books.filter(sub.pick);
  books.sort((a, b) => (a.id < b.id ? -1 : 1));
  // Fisher–Yates with the seeded PRNG over the sorted list, then walk in order.
  for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
  const out = [];
  let wantColumns = sub.columns || 0;
  let skippedBooks = 0;
  // SPARES: the draw continues past n so that a page every engine finds textless (a cover, a
  // plate — the stored-OCR filter cannot see pages that were never OCR'd) can be replaced by
  // the next book in the same deterministic order instead of by a fresh, unsealed draw.
  const want = sub.n + (sub.spares ?? SPARES);
  for (const book of books) {
    if (out.length >= want) break;
    const lo = Math.max(1, Math.floor(book.pages_count * 0.10)), hi = Math.max(lo + 1, Math.floor(book.pages_count * 0.90));
    let chosen = null;
    // Multi-column quota: prefer a page whose stored OCR carries a multi-column tag.
    if (wantColumns > 0) {
      const cols = await db.collection('pages').find(
        { book_id: book.id, page_number: { $gte: lo, $lte: hi }, 'ocr.data': COLUMNS_RE },
        { projection: { page_number: 1, 'ocr.data': 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1 }, maxTimeMS: 60000 },
      ).sort({ page_number: 1 }).limit(40).toArray();
      if (cols.length) { chosen = cols[Math.floor(rand() * cols.length)]; chosen._columns = true; }
    }
    for (let t = 0; !chosen && t < 6; t++) {
      const pn = lo + Math.floor(rand() * (hi - lo + 1));
      const page = await db.collection('pages').findOne({ book_id: book.id, page_number: pn },
        { projection: { page_number: 1, 'ocr.data': 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1 }, maxTimeMS: 30000 });
      if (!page) continue;
      if (!getPageSource(page)) continue;
      if (page.ocr?.data && letters(stripTags(page.ocr.data)) < MIN_LETTERS) continue;
      chosen = page;
    }
    if (!chosen) { skippedBooks++; continue; }
    if (chosen._columns) wantColumns--;
    const year = yearOf(book.published);
    const slug = `${stratum}-${book.id.slice(-6)}-p${chosen.page_number}`;
    out.push({
      slug, book_id: book.id, page_number: chosen.page_number, substratum: sub.name,
      title: (book.title || '').slice(0, 120), year, published: book.published || null,
      language: book.language, provider: book.contributing_library || book.image_source?.provider || null,
      image_url: getPageSource(chosen), stored_ocr_chars: chosen.ocr?.data ? chosen.ocr.data.length : 0,
      multi_column_tag: !!chosen._columns, reference_plan: sub.reference,
    });
  }
  out.forEach((p, i) => { p.spare = i >= sub.n; });
  console.log(`  ${sub.name}: ${Math.min(out.length, sub.n)}/${sub.n} pages + ${Math.max(0, out.length - sub.n)} spares from ${books.length} eligible books (${skippedBooks} books skipped, ${out.filter(p => p.multi_column_tag && !p.spare).length} multi-column-tagged)`);
  return out;
}

async function sealStratum(stratum) {
  const cfg = STRATA[stratum];
  if (!cfg) throw new Error(`unknown stratum ${stratum}; known: ${Object.keys(STRATA).join(', ')}`);
  const regPath = path.join(REG_DIR, `${stratum}.json`);
  let reg;
  if (fs.existsSync(regPath) && !args.reseal) {
    reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    console.log(`${stratum}: registry already sealed ${reg.sealed_at} (${reg.pages.length} pages) — reusing; pass --reseal to redraw`);
  } else {
    console.log(`${stratum}: drawing (issue #${cfg.issue}, seed ${cfg.seed})`);
    const { db } = await connect();
    // One PRNG per sub-stratum (seed + index): a sub-stratum's draw must not shift when the
    // one before it consumes a different number of random numbers (spares, skipped pages).
    const pages = [];
    for (const [i, sub] of cfg.subs.entries()) pages.push(...await drawSub(db, stratum, sub, mulberry32(cfg.seed * 100 + i)));
    reg = {
      stratum, issue: cfg.issue, seed: cfg.seed, sealed_at: new Date().toISOString(),
      draw_rule: 'one page per book; books Fisher–Yates-shuffled with Mulberry32(seed*100+substratum index) over the id-sorted eligible list; page uniform over interior 10–90%; skip if no usable image or stored OCR < 120 letters; multi-column quota from pages whose stored OCR carries a <columns>N≥2 tag. The draw is reproducible only against the eligible id list AS OF THE SEAL DATE (imports keep adding books, which reshuffles everything) — this file, not the script, is the seal.',
      max_width: MAX_WIDTH, n: pages.filter(p => !p.spare).length, spares: pages.filter(p => p.spare).length,
      spare_rule: 'a sealed page that every engine returns textless (<30 letters) is replaced by the first unused spare of its sub-stratum; the replacement is recorded in the results file',
      substrata: cfg.subs.map(s => ({ name: s.name, n: s.n, reference: s.reference })),
      pages,
    };
    if (!args.dry) { fs.mkdirSync(REG_DIR, { recursive: true }); fs.writeFileSync(regPath, JSON.stringify(reg, null, 2)); }
    else console.log(pages.map(p => `${p.slug}${p.spare ? ' (spare)' : ''}`).join('\n'));
  }
  if (!args.out || args.dry) return reg;
  // Export images, downscaled to MAX_WIDTH so every engine sees the same pixels.
  const outDir = path.join(args.out, stratum);
  fs.mkdirSync(outDir, { recursive: true });
  const sharp = (await import('sharp')).default;
  const manifest = [];
  let n = 0, failed = 0;
  for (const p of reg.pages) {
    const dest = path.join(outDir, `${p.slug}.jpg`);
    if (fs.existsSync(dest)) { manifest.push({ slug: p.slug, cached: true }); n++; continue; }
    try {
      let buf = await fetchImage(p.image_url, 60000);
      const meta = await sharp(buf).metadata();
      const width = Math.min(MAX_WIDTH, meta.width);
      if (meta.width > MAX_WIDTH) buf = await sharp(buf).resize({ width: MAX_WIDTH }).jpeg({ quality: 92 }).toBuffer();
      else if (meta.format !== 'jpeg') buf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
      fs.writeFileSync(dest, buf);
      manifest.push({ slug: p.slug, width, bytes: buf.length });
      n++;
    } catch (e) { failed++; console.log(`  ! ${p.slug}: ${e.message.slice(0, 100)}`); manifest.push({ slug: p.slug, error: e.message.slice(0, 100) }); }
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ stratum, exported_at: new Date().toISOString(), pages: manifest }, null, 2));
  console.log(`  exported ${n} images to ${outDir} (${failed} failed)`);
  return reg;
}

/**
 * --promote=<slug,slug,…> [--reason=textless|image_unavailable]: retire sealed pages and promote
 * the first unused spare of the same sub-stratum in draw order. --promote-missing retires every
 * sealed page whose image could not be exported (a 403 from a lending-library source, say).
 * Both are recorded in the registry (`retired`, `replaced_by`, `promoted`), never silently.
 */
function promote(stratum, retireSlugs, reason) {
  const regPath = path.join(REG_DIR, `${stratum}.json`);
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  let changed = 0;
  for (const slug of retireSlugs) {
    const p = reg.pages.find(x => x.slug === slug);
    if (!p || p.retired) continue;
    const spare = reg.pages.find(x => x.spare && !x.promoted && x.substratum === p.substratum && (!args.out || fs.existsSync(path.join(args.out, stratum, `${x.slug}.jpg`))));
    p.retired = reason; p.replaced_by = spare ? spare.slug : null;
    if (spare) { spare.promoted = true; spare.replaces = slug; }
    console.log(`  ${stratum}: retired ${slug} (${reason}) → ${spare ? spare.slug : 'NO SPARE LEFT'}`);
    changed++;
  }
  if (changed && !args.dry) fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
  return changed;
}

loadEnv();
const strata = args.all ? Object.keys(STRATA) : String(args.stratum || '').split(',').filter(Boolean);
if (!strata.length) { console.error('--stratum=<name>[,name] or --all required'); process.exit(1); }
if (args.promote || args['promote-missing']) {
  for (const s of strata) {
    if (args['promote-missing']) {
      const reg = JSON.parse(fs.readFileSync(path.join(REG_DIR, `${s}.json`), 'utf8'));
      const missing = reg.pages.filter(p => !p.spare && !p.retired && !fs.existsSync(path.join(args.out, s, `${p.slug}.jpg`))).map(p => p.slug);
      promote(s, missing, 'image_unavailable');
    }
    if (typeof args.promote === 'string') promote(s, args.promote.split(','), args.reason || 'textless');
  }
  process.exit(0);
}
for (const s of strata) await sealStratum(s);
await disconnect();
