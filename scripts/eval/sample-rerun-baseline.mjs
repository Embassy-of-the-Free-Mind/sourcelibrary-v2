#!/usr/bin/env node
/**
 * SELECT (do not run) an unbiased baseline sample for a deliberate second OCR pass.
 *
 * Everything the revision corpus can say describes 97,421 pages that are 0.67% of
 * the 14.5M OCR'd pages, and they are there because something re-OCR'd them — for
 * reasons nobody recorded. That selection cannot be corrected after the fact, only
 * replaced. This picks the replacement: a probability sample with known inclusion
 * weights, so a rate measured on it can be weighted back to the corpus.
 *
 * DESIGN
 *
 *   Stratified by language x era, two-stage within each stratum: books drawn with
 *   probability proportional to their OCR'd page count, then one random OCR'd page
 *   per drawn book. One page per book on purpose — pages within a book share a
 *   scan, a typeface and a compositor, so a second page from the same book adds far
 *   less information than a page from a different one.
 *
 *   Allocation is proportional to stratum size with a FLOOR, because the questions
 *   that matter most sit in the smallest strata: Tibetan reads 24.7% raw agreement
 *   against Latin's 82.3%, and a purely proportional sample would draw ~30 Tibetan
 *   pages and settle nothing. Every row therefore carries `design_weight` — the
 *   floor makes rare strata estimable, the weight keeps the corpus total unbiased.
 *   IGNORING THE WEIGHT WHEN AGGREGATING WILL OVERSTATE THE RARE STRATA.
 *
 *   The rerun config per row is deliberate, not incidental:
 *     - a DIFFERENT model than the page currently carries -> genuine independence.
 *       96.9% of existing pairs are one model reading twice, which measures
 *       repeatability, not reading.
 *     - the SAME prompt version -> no instructed drift. Latin reads 82.3% overall
 *       and 90.0% among same-prompt pairs, so a mixed-prompt design would spend the
 *       budget re-measuring our own prompt changes.
 *
 * THIS SCRIPT SPENDS NOTHING. It writes a sample manifest and a design summary.
 * Submitting the batch is a separate, explicit step.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/sample-rerun-baseline.mjs [--size=5000] [--floor=150] [--seed=1]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const SIZE = parseInt(args.size || '5000');
const FLOOR = parseInt(args.floor || '150');
const SEED = parseInt(args.seed || '1');
const DATE = args.date || new Date().toISOString().slice(0, 10);
const OUT_DIR = args['out-dir'] || path.join(__dirname, 'results');
const OUT_JSONL = path.join(OUT_DIR, `rerun-baseline-sample-${DATE}.jsonl`);
const OUT_REPORT = path.join(OUT_DIR, `rerun-baseline-sample-${DATE}.md`);
const SITE = 'https://sourcelibrary.org';

// Deterministic PRNG: the sample must be reproducible from (seed, code) alone, and
// Math.random() would make the manifest unauditable.
let _s = SEED >>> 0;
const rand = () => (((_s = (_s * 1664525 + 1013904223) >>> 0)) / 4294967296);

/**
 * `books.language` is FREE TEXT and mixes ISO codes with names and compound
 * statements: `lat` and `Latin` are the same language stored two ways, and
 * `Parthian; Sogdian (script); Middle Persian; Sogdian` is one book. Stratifying on
 * the raw field produced 624 strata, 301 of them singletons — cells of one cannot
 * yield a variance, and the weights spanned 21,782x, which lets a single page
 * dominate any weighted mean. Canonicalise, take the PRIMARY language, and keep
 * only the strata big enough to estimate anything.
 */
const ISO = {
  lat: 'Latin', ger: 'German', deu: 'German', fre: 'French', fra: 'French', eng: 'English',
  grc: 'Greek', gre: 'Greek', ell: 'Greek', ita: 'Italian', dut: 'Dutch', nld: 'Dutch',
  heb: 'Hebrew', ara: 'Arabic', san: 'Sanskrit', tib: 'Tibetan', bod: 'Tibetan',
  chi: 'Chinese', zho: 'Chinese', spa: 'Spanish', rus: 'Russian', per: 'Persian',
  fas: 'Persian', jpn: 'Japanese', kor: 'Korean', tur: 'Turkish', pol: 'Polish',
  swe: 'Swedish', dan: 'Danish', por: 'Portuguese', cze: 'Czech', hun: 'Hungarian',
  und: 'Unknown', mul: 'Multiple',
};
const canonLanguage = raw => {
  if (!raw) return 'Unknown';
  // primary language only: everything before the first separator
  let t = String(raw).split(/[;,\/]|\band\b|\bwith\b/i)[0].trim();
  t = t.replace(/\((script|language)\)/gi, '').replace(/\s+/g, ' ').trim();
  const lower = t.toLowerCase();
  if (ISO[lower]) return ISO[lower];
  if (!t) return 'Unknown';
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const era = y => {
  if (typeof y !== 'number' || !Number.isFinite(y)) return 'unknown';
  if (y < 1500) return 'pre-1500';
  if (y < 1600) return '1500-1599';
  if (y < 1700) return '1600-1699';
  if (y < 1800) return '1700-1799';
  if (y < 1900) return '1800-1899';
  return '1900+';
};

// Pick the OTHER model, so the second pass is independent rather than a repeat.
const otherModel = current => (current && /3-flash/.test(current))
  ? 'gemini-3.1-flash-lite-preview'
  : 'gemini-3-flash-preview';

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  // Stratum populations from `books`, not `pages`: a 19M-document group-by times
  // out, and pages inherit their book's language and year anyway.
  console.log('measuring stratum populations from books…');
  const books = await db.collection('books').find(
    { pages_ocr: { $gt: 0 } },
    { projection: { id: 1, slug: 1, language: 1, year: 1, pages_ocr: 1, visible: 1 } },
  ).maxTimeMS(600000).toArray();
  console.log(`  ${books.length.toLocaleString()} books carry OCR'd pages`);

  // Keep the languages worth stratifying on; fold the tail into one cell rather
  // than 300 singletons. `TOP_LANGS` is by OCR'd page population, not book count.
  const langPages = new Map();
  for (const b of books) {
    const l = canonLanguage(b.language);
    langPages.set(l, (langPages.get(l) || 0) + b.pages_ocr);
  }
  const TOP_N = parseInt(args['top-langs'] || '14');
  const keep = new Set([...langPages.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map(e => e[0]));
  console.log(`  stratifying on ${keep.size} languages, remainder folded into 'Other'`);

  const strata = new Map();
  for (const b of books) {
    const l = canonLanguage(b.language);
    const key = `${keep.has(l) ? l : 'Other'} | ${era(b.year)}`;
    if (!strata.has(key)) strata.set(key, { key, pages: 0, books: [] });
    const s = strata.get(key);
    s.pages += b.pages_ocr;
    s.books.push(b);
  }
  const totalPages = [...strata.values()].reduce((n, s) => n + s.pages, 0);
  console.log(`  ${strata.size} strata, ${totalPages.toLocaleString()} OCR'd pages total`);

  // Allocation: proportional, floored, then trimmed back to SIZE.
  // Drop strata too small to estimate anything, folding their pages into the
  // weights of what remains would misstate the total, so they are simply excluded
  // from the frame and the exclusion is REPORTED — a sample that quietly covers 94%
  // of the corpus while claiming to cover it all is the failure this whole exercise
  // is about.
  const MIN_STRATUM = parseInt(args['min-stratum'] || '2000');
  const all = [...strata.values()].sort((a, b) => b.pages - a.pages);
  const list = all.filter(s => s.pages >= MIN_STRATUM && s.books.length >= 2);
  const dropped = all.filter(s => !list.includes(s));
  const framePages = list.reduce((n, s) => n + s.pages, 0);
  console.log(`  ${list.length} strata in frame (${framePages.toLocaleString()} pages), ` +
    `${dropped.length} dropped as too small (${(totalPages - framePages).toLocaleString()} pages, ` +
    `${(100 * (totalPages - framePages) / totalPages).toFixed(2)}% of the corpus)`);

  // Proportional with a floor, then SCALE the over-allocation down proportionally.
  // The first version decremented the largest cell repeatedly, which flattened every
  // stratum to the same size — the worst of both designs, and it silently discarded
  // the proportionality it was supposed to preserve.
  for (const s of list) {
    const proportional = SIZE * s.pages / framePages;
    s.alloc = Math.min(s.books.length, Math.max(Math.min(FLOOR, s.books.length), Math.round(proportional)));
  }
  let allocated = list.reduce((n, s) => n + s.alloc, 0);
  if (allocated > SIZE) {
    const floored = list.filter(s => s.alloc <= FLOOR).reduce((n, s) => n + s.alloc, 0);
    const scale = Math.max(0, (SIZE - floored)) / Math.max(1, allocated - floored);
    for (const s of list) if (s.alloc > FLOOR) s.alloc = Math.max(FLOOR, Math.round(s.alloc * scale));
  }

  const out = fs.createWriteStream(OUT_JSONL, { flags: 'w' });
  let written = 0, missed = 0;
  for (const s of list) {
    if (!s.alloc) continue;
    // Books drawn with probability proportional to OCR'd pages (systematic PPS).
    const cum = []; let acc = 0;
    for (const b of s.books) { acc += b.pages_ocr; cum.push(acc); }
    const step = acc / s.alloc;
    const start = rand() * step;
    const picked = new Set();
    for (let i = 0; i < s.alloc; i++) {
      const target = start + i * step;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
      picked.add(lo);
    }
    for (const idx of picked) {
      const b = s.books[idx];
      // One random OCR'd page from this book.
      const page = (await db.collection('pages').aggregate([
        { $match: { book_id: b.id, 'ocr.data': { $type: 'string', $ne: '' } } },
        { $sample: { size: 1 } },
        { $project: { id: 1, page_number: 1, 'ocr.model': 1, 'ocr.prompt_version': 1, archived_photo: 1, display_photo: 1, photo: 1 } },
      ], { maxTimeMS: 120000 }).toArray())[0];
      if (!page) { missed++; continue; }
      out.write(JSON.stringify({
        page_id: page.id,
        book_id: b.id,
        book_slug: b.slug || null,
        page_number: page.page_number ?? null,
        language: b.language || null,
        year: typeof b.year === 'number' ? b.year : null,
        stratum: s.key,
        // Weight back to the corpus: pages this row stands for. Aggregating without
        // it overstates whichever strata the floor protected.
        design_weight: +(s.pages / s.alloc).toFixed(2),
        stratum_pages: s.pages,
        stratum_sampled: s.alloc,
        current_model: page.ocr?.model || null,
        current_prompt_version: page.ocr?.prompt_version ?? null,
        rerun_model: otherModel(page.ocr?.model),
        rerun_prompt_version: page.ocr?.prompt_version ?? null,
        image: page.archived_photo || page.display_photo || page.photo || null,
        reader_url: b.slug ? `${SITE}/book/${b.slug}/page/${page.id}` : null,
      }) + '\n');
      written++;
    }
    console.log(`  ${s.key.padEnd(34)} pop ${String(s.pages).padStart(8)}  sampled ${s.alloc}`);
  }
  await new Promise(r => out.end(r));
  await client.close();

  // Kish effective sample size: how many equally-weighted pages this sample is
  // worth. A wide weight spread means a few rows carry the estimate, and quoting n
  // without it overstates the precision by a lot.
  const wts = [];
  for (const s2 of list) for (let i = 0; i < s2.alloc; i++) wts.push(s2.pages / s2.alloc);
  const sw = wts.reduce((a, b) => a + b, 0), sw2 = wts.reduce((a, b) => a + b * b, 0);
  const nEff = sw2 ? (sw * sw) / sw2 : 0;

  const md = [
    `# Baseline rerun sample — selection only (${DATE})`, '',
    `**Nothing has been submitted.** This is a manifest of ${written.toLocaleString()} pages to transcribe a`,
    `second time, drawn so that a rate measured on them can be weighted back to the corpus.`, '',
    '## Why a new sample rather than more filtering', '',
    `The revision corpus describes 97,421 pages — 0.67% of the ~14.5M OCR'd pages — and they`,
    `are in it because something re-OCR'd them, for reasons nobody recorded. No amount of`,
    `cleaning makes that representative. A probability sample replaces it.`, '',
    '## Design', '',
    `- stratified by language × era, ${list.filter(s => s.alloc).length} strata used`,
    `- two-stage: books drawn with probability proportional to OCR'd page count (systematic PPS),`,
    `  then ONE random OCR'd page per book — pages in a book share a scan and a typeface, so a`,
    `  second page from the same book adds little`,
    `- allocation proportional to stratum size with a floor of ${FLOOR}, because the sharpest`,
    `  questions sit in the smallest strata (Tibetan reads 24.7% raw agreement against Latin's`,
    `  82.3%); every row carries \`design_weight\` to undo the floor when aggregating`,
    `- rerun config per row: a DIFFERENT model (96.9% of existing pairs are one model twice,`,
    `  which measures repeatability) and the SAME prompt version (Latin reads 82.3% overall`,
    `  against 90.0% same-prompt, so a mixed design would re-measure our own prompt changes)`,
    `- deterministic PRNG seeded with ${SEED}: the manifest is reproducible from seed + code`, '',
    `${missed} books yielded no page and were skipped.`, '',
    `- weights span ${Math.min(...wts).toFixed(0)} to ${Math.max(...wts).toFixed(0)} (${(Math.max(...wts) / Math.max(1, Math.min(...wts))).toFixed(0)}x)`,
    `- **Kish effective sample size ${Math.round(nEff).toLocaleString()}** of ${written.toLocaleString()} rows — quote this, not the row count`,
    `- frame covers ${framePages.toLocaleString()} of ${totalPages.toLocaleString()} OCR'd pages ` +
      `(${(100 * framePages / totalPages).toFixed(2)}%); ${dropped.length} strata below ${MIN_STRATUM} pages were excluded and are NOT represented`, '',
    '## Estimated cost', '',
    `At the observed batch rate of ~\$0.00079/page, ${written.toLocaleString()} pages ≈ **\$${(written * 0.00079).toFixed(2)}**.`, '',
    '## Strata', '', '| stratum | OCR pages in corpus | sampled | weight |', '|---|---:|---:|---:|',
    ...list.filter(s => s.alloc).map(s => `| ${s.key} | ${s.pages.toLocaleString()} | ${s.alloc} | ${(s.pages / s.alloc).toFixed(0)} |`),
    '',
    `Manifest: \`${path.basename(OUT_JSONL)}\``, '',
  ].join('\n');
  fs.writeFileSync(OUT_REPORT, md);
  console.log(`\nwrote ${written.toLocaleString()} rows (skipped ${missed})`);
  console.log(`→ ${OUT_JSONL}\n→ ${OUT_REPORT}`);
  console.log(`\nNOTHING SUBMITTED. Estimated cost if run: $${(written * 0.00079).toFixed(2)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
