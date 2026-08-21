#!/usr/bin/env node
/**
 * Census of hard-page candidates, by failure class (#3469).
 *
 * Before sampling exemplars we need to know what the corpus can actually
 * supply. This measures availability per difficulty class so the dataset
 * design is driven by real counts rather than by the taxonomy we wish we had.
 *
 * SAMPLING NOTE — `$sample` must be the FIRST pipeline stage. A `$match` on
 * `ocr.data` (regex, or even `$exists`) is an unindexed collection scan over
 * millions of pages and exceeds `maxTimeMS` every time; the storage engine's
 * random cursor only kicks in when `$sample` leads. So: draw a random slab of
 * pages, then classify in JS.
 *
 * BIAS WARNING, and it is the whole design problem (see #3469):
 * classes sourced from the model's OWN output select pages where the model
 * already noticed the defect. A `<warning>` about foxing is a page it handled;
 * a `<margin>` tag is marginalia it FOUND. Those are upper-bound-flattering
 * samples and are labelled `self_reported` here so nobody mistakes them for a
 * random draw of hard pages. Proven-miss classes must come from revision
 * disagreement instead, which is `scripts/eval/hard-page-sample.mjs`.
 *
 * Usage:
 *   node scripts/eval/hard-page-census.mjs [--sample=60000] [--json=path]
 */

import { MongoClient } from 'mongodb';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const SAMPLE = parseInt(args.sample || '60000', 10);

/**
 * Warning-text classifiers. Built by reading real `<warning>` bodies, not
 * invented — each pattern is deliberately loose because the model writes the
 * warning in free prose and its vocabulary is not fixed.
 */
const WARNING_CLASSES = [
  ['bleed_through', /bleed[- ]?through|show[- ]?through|verso|reverse side|other side|ghost/i],
  ['staining', /stain|discolou?r|water damage|damp/i],
  ['ink_blot', /ink blot|blot|smudge|over[- ]?ink|saturat|bleed of ink/i],
  ['fading', /fade|faded|faint|light print|weak impression|worn type/i],
  ['foxing', /fox(ing|ed)|spot|speckl|mottl/i],
  ['gutter_loss', /gutter|tight bind|curvature|spine|obscured by the bind/i],
  ['handwriting', /handwrit|manuscript|hand[- ]?written|cursive|annotation in ink/i],
  ['cropping', /crop|cut off|truncat|edge of the page|outside the scan|occlud/i],
  ['blur', /blur|out of focus|motion|unfocus/i],
  ['skew', /skew|tilt|rotat|angle/i],
];

/** Scripts written without inter-word spaces — word-level metrics lie here. */
const SPACELESS = /tibet|chinese|japanese|thai|khmer|burmese|lao|han|sanskrit|devanagari/i;

const has = (t, re) => re.test(t);

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set. Run with: set -a; source .env.production.local; set +a; node ...');
    process.exit(1);
  }
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');

  console.log(`\n  Drawing a random sample of ${SAMPLE.toLocaleString()} pages…\n`);

  const pages = await db.collection('pages').aggregate([
    { $sample: { size: SAMPLE } },
    { $project: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, scan_quality: 1 } },
  ], { allowDiskUse: true, maxTimeMS: 600000 }).toArray();

  const withOcr = pages.filter(p => p?.ocr?.data);
  const warnClass = new Map();
  const scanClass = new Map();
  let warned = 0, marginTagged = 0, imageOnly = 0, multiCol = 0;
  const bookIds = new Set();

  for (const p of pages) {
    const sc = p.scan_quality?.scan_class;
    if (sc) scanClass.set(sc, (scanClass.get(sc) || 0) + 1);
  }

  for (const p of withOcr) {
    const t = p.ocr.data;
    bookIds.add(p.book_id);
    const w = t.match(/<warning>([\s\S]*?)<\/warning>/gi);
    if (w) {
      warned++;
      const body = w.join(' ');
      for (const [name, re] of WARNING_CLASSES) {
        if (has(body, re)) warnClass.set(name, (warnClass.get(name) || 0) + 1);
      }
    }
    if (/<margin>|<gloss>|<note>/i.test(t)) marginTagged++;
    // A page whose only text is an image description / caption labels.
    if (/<image-desc>|<caption>/i.test(t) && t.replace(/<[^>]+>/g, '').trim().length < 400) imageOnly++;
    if (/<columns>\s*[2-9]/i.test(t)) multiCol++;
  }

  // Language mix, for the space-less-script class. Books, not pages — the
  // language lives on the book record.
  const books = await db.collection('books').find(
    { id: { $in: [...bookIds].slice(0, 5000) } },
    { projection: { id: 1, language: 1 } }
  ).maxTimeMS(120000).toArray().catch(() => []);
  let spaceless = 0;
  for (const b of books) if (b.language && SPACELESS.test(b.language)) spaceless++;

  const pct = (n, d) => d ? `${(100 * n / d).toFixed(2)}%` : 'n/a';
  const N = pages.length, O = withOcr.length;

  console.log(`  pages sampled ............ ${N.toLocaleString()}`);
  console.log(`  with OCR text ............ ${O.toLocaleString()} (${pct(O, N)})`);
  console.log(`  carrying a <warning> ..... ${warned.toLocaleString()} (${pct(warned, O)} of OCR'd)\n`);

  console.log('  SELF-REPORTED defect classes  (share of warned pages)');
  console.log('  ── biased toward pages the model HANDLED; not a miss sample ──');
  const rows = [...warnClass.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, n] of rows) {
    const projected = Math.round(n / O * 100000); // per 100k OCR'd pages
    console.log(`    ${name.padEnd(16)} ${String(n).padStart(5)}  ${pct(n, warned).padStart(7)}  ≈${projected.toLocaleString()}/100k pages`);
  }

  console.log('\n  scan_quality.scan_class  (precise where present, thin coverage)');
  for (const [name, n] of [...scanClass.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${name.padEnd(20)} ${String(n).padStart(5)}  ${pct(n, N)}`);
  }

  console.log('\n  Other structural classes');
  console.log(`    margin/gloss tagged  ${String(marginTagged).padStart(5)}  ${pct(marginTagged, O)}   [SELF-REPORTED — found, not missed]`);
  console.log(`    image-only / labels  ${String(imageOnly).padStart(5)}  ${pct(imageOnly, O)}`);
  console.log(`    multi-column         ${String(multiCol).padStart(5)}  ${pct(multiCol, O)}`);
  console.log(`    space-less script    ${String(spaceless).padStart(5)}  ${pct(spaceless, books.length)} of ${books.length} sampled books`);

  console.log(`\n  Feasibility: a class needs ~20 exemplars. At this sample rate a class`);
  console.log(`  at ${pct(1, O)} yields ~1 per ${Math.round(O).toLocaleString()} pages drawn.\n`);

  if (args.json) {
    const fs = await import('fs');
    fs.writeFileSync(args.json, JSON.stringify({
      generated_at: new Date().toISOString(),
      sample_size: N, with_ocr: O, warned,
      warning_classes: Object.fromEntries(warnClass),
      scan_classes: Object.fromEntries(scanClass),
      margin_tagged: marginTagged, image_only: imageOnly,
      multi_column: multiCol, spaceless_books: spaceless, books_sampled: books.length,
    }, null, 2));
    console.log(`  wrote ${args.json}\n`);
  }

  await c.close();
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
