// scripts/maintenance/audit-language-provenance.mjs
//
// Issue #2184 / #2185: detect books whose catalogued `language` disagrees with
// the language Gemini actually OCR'd off the scanned pages. The trigger case is
// Pico's Oratio — catalogued Latin/1486 but the scan is a 20th-c. Russian
// translation. This promotes the one-off audit from #2184 into a committed,
// re-runnable guard.
//
// Method: for each IA-sourced book, compare catalogued `language` against the
// per-page <lang> tag Gemini emits in `ocr.data`. To avoid the front-matter /
// facsimile false positives noted in #2184 (the praefatio of a Greek critical
// edition is Latin/English), we sample ACROSS THE WHOLE BOOK, not just the first
// N pages — evenly spaced page_numbers rather than `.limit(15)` on insertion order.
//
// Usage:
//   set -a; source .env.production.local; set +a; node scripts/maintenance/audit-language-provenance.mjs [--provider all] [--sample 20] [--json out.json]
//
// Read-only. Never writes.

import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PROVIDER = getArg('--provider', 'internet_archive'); // 'all' to scan every provider
const SAMPLE = parseInt(getArg('--sample', '20'), 10);     // pages to sample per book
const JSON_OUT = getArg('--json', null);

// ISO-639 (and common 3-letter) → display name. Mirror of the importer's normalizer.
const ISO = {
  la: 'latin', lat: 'latin', grc: 'greek', el: 'greek', gre: 'greek', ell: 'greek',
  sa: 'sanskrit', san: 'sanskrit', zh: 'chinese', chi: 'chinese', zho: 'chinese',
  ar: 'arabic', ara: 'arabic', de: 'german', ger: 'german', deu: 'german',
  fr: 'french', fra: 'french', fre: 'french', it: 'italian', ita: 'italian',
  ru: 'russian', rus: 'russian', en: 'english', eng: 'english',
  hi: 'hindi', hin: 'hindi', te: 'telugu', tel: 'telugu', he: 'hebrew', heb: 'hebrew',
  syr: 'syriac', nl: 'dutch', dut: 'dutch', nld: 'dutch', es: 'spanish', spa: 'spanish',
  pt: 'portuguese', por: 'portuguese', mar: 'marathi', mr: 'marathi',
  fa: 'persian', per: 'persian', fas: 'persian', ja: 'japanese', jpn: 'japanese',
  ta: 'tamil', tam: 'tamil', pl: 'polish', pol: 'polish', cs: 'czech', ces: 'czech',
  la_grc: 'latin', tr: 'turkish', tur: 'turkish',
};
const NULL = new Set([
  'none', 'n/a', 'na', 'unknown', 'und', 'null', '', 'multiple', 'mul',
  'mixed', 'various', 'zxx', 'undetermined',
]);
const norm = (s) => {
  let x = (s || '').toLowerCase().trim().replace(/^(modern|ancient|old|classical|medieval|middle)\s+/, '');
  return ISO[x] || x;
};

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set. Run: set -a; source .env.production.local; set +a; node ...');
  process.exit(1);
}

const c = new MongoClient(uri);
await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

const bookFilter = {
  language: { $exists: true, $ne: null },
  ...(PROVIDER === 'all' ? {} : { 'image_source.provider': PROVIDER }),
};

const all = await books
  .find(bookFilter, { projection: { language: 1, title: 1, slug: 1, pages_count: 1 } })
  .toArray();

console.error(`Scanning ${all.length} books (provider=${PROVIDER}, sample=${SAMPLE})...`);

const out = [];
let scanned = 0;
let withTags = 0;

for (const b of all) {
  scanned++;
  if (scanned % 500 === 0) console.error(`  ...${scanned}/${all.length}`);

  const cat = norm(b.language);
  if (!cat || NULL.has(cat)) continue;

  // Sample evenly across the whole book. Pull pages that have a <lang> tag,
  // sorted by page_number, then take an evenly-spaced subset.
  const tagged = await pages
    .find(
      { book_id: b._id.toString(), 'ocr.data': /<lang>/i },
      { projection: { 'ocr.data': 1, page_number: 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  if (tagged.length < 3) continue;
  withTags++;

  const step = Math.max(1, Math.floor(tagged.length / SAMPLE));
  const sampled = tagged.filter((_, i) => i % step === 0).slice(0, SAMPLE);

  const tags = sampled
    .map((p) => norm((p.ocr.data.match(/<lang>([^<]+)<\/lang>/i) || [])[1]))
    .filter((t) => t && !NULL.has(t) && !/[,/]/.test(t));

  if (tags.length < 3) continue;

  const catFrac = tags.filter((t) => t === cat).length / tags.length;
  const freq = {};
  tags.forEach((t) => (freq[t] = (freq[t] || 0) + 1));
  const dom = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];

  if (dom === cat) continue;

  // Classify per #2184 buckets
  let bucket;
  if (catFrac === 0) bucket = 'absent';        // ~196 cohort — strongest mislabel signal
  else if (catFrac < 0.2) bucket = 'front_matter';
  else bucket = 'bilingual';

  out.push({
    id: b._id.toString(),
    slug: b.slug || null,
    cat,
    dom,
    catFrac: Number(catFrac.toFixed(2)),
    sampled: tags.length,
    title: (b.title || '').slice(0, 70),
    bucket,
  });
}

out.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.catFrac - b.catFrac);

const byBucket = out.reduce((m, r) => ((m[r.bucket] = (m[r.bucket] || 0) + 1), m), {});

console.error(`\nScanned ${scanned} books; ${withTags} had >=3 <lang>-tagged pages.`);
console.error(`${out.length} mismatches:`, byBucket);
console.error('(absent = catalogued language never appears on sampled pages — strongest signal)\n');

console.table(out.filter((r) => r.bucket === 'absent').slice(0, 50));

if (JSON_OUT) {
  const { writeFileSync } = await import('fs');
  writeFileSync(JSON_OUT, JSON.stringify({ generatedFilter: bookFilter, counts: byBucket, mismatches: out }, null, 2));
  console.error(`Wrote ${out.length} rows to ${JSON_OUT}`);
}

await c.close();
