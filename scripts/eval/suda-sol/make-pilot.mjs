// Build 50-entry stratified pilot sample for subagent gold labeling. Issue #3884.
// Writes pilot/NNN-<adler_id>.json, one self-contained judgment packet per entry.
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const D = (process.env.SOL_DATA_DIR ?? 'scripts/output/sol-harvest') + '/';
const BOOK = '69a99ce86c7545e2236e12de';
const aligned = readFileSync(D + 'aligned.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const sol = Object.fromEntries(
  readFileSync(D + 'sol.jsonl', 'utf8').trim().split('\n').map(JSON.parse).map((r) => [r.adler_id, r]));

// deterministic PRNG (no Math.random in workflows; fine here but keep reproducible)
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const pool = aligned.filter((r) => r.matched && r.bekker_text && r.bekker_text.split(' ').length >= 5);
const byBasis = { anchor: [], 'gap-fuzzy': [], 'gap-exact': [], 'interior-split': [] };
for (const r of pool) byBasis[r.basis]?.push(r);
const wc = (r) => r.bekker_text.split(' ').length;
const strat = (arr, n) => {
  const short = shuffle(arr.filter((r) => wc(r) < 40));
  const med = shuffle(arr.filter((r) => wc(r) >= 40 && wc(r) <= 150));
  const long = shuffle(arr.filter((r) => wc(r) > 150));
  const k = Math.ceil(n / 3);
  return shuffle([...short.slice(0, k), ...med.slice(0, k), ...long.slice(0, n - 2 * k > 0 ? n - 2 * k : k)]).slice(0, n);
};
const sample = [
  ...strat(byBasis.anchor, 35),
  ...strat(byBasis['gap-fuzzy'], 8),
  ...strat(byBasis['gap-exact'], 3),
  ...strat(byBasis['interior-split'], 4),
];
console.log('sample:', sample.length, 'entries; pages needed:',
  new Set(sample.flatMap((r) => r.scan_pages)).size);

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const pageNums = [...new Set(sample.flatMap((r) => r.scan_pages))];
const pages = await c.db('bookstore').collection('pages')
  .find({ book_id: BOOK, page_number: { $in: pageNums } })
  .project({ page_number: 1, 'translation.data': 1 }).toArray();
await c.close();
const tr = Object.fromEntries(pages.map((p) => [p.page_number, p.translation?.data ?? null]));

mkdirSync(D + 'pilot', { recursive: true });
sample.forEach((r, i) => {
  const s = sol[r.adler_id];
  const packet = {
    adler_id: r.adler_id,
    basis: r.basis,
    scan_pages: r.scan_pages,
    bekker_greek_ocr: r.bekker_text,
    our_page_translations: Object.fromEntries(r.scan_pages.map((p) => [p, tr[p]])),
    sol_headword: s.headword_unicode,
    sol_translated_headword: s.translated_headword,
    sol_translation: s.translation,
    adler_greek_via_sol: s.greek_unicode,
    sol_translator: s.translator,
  };
  writeFileSync(`${D}pilot/${String(i).padStart(2, '0')}-${r.adler_id.replace(',', '-')}.json`,
    JSON.stringify(packet, null, 1));
});
console.log('wrote', sample.length, 'packets; missing page translations:',
  sample.filter((r) => r.scan_pages.some((p) => !tr[p])).length);
