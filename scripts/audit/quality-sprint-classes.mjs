#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/language-vs-ocr.mjs (#4654) already measures language field vs the OCR's
 * declared language — the fifth sprint class runs through it, not through here. scripts/lib/ia-ocr-cohort.mjs
 * `wasRecitationRefused()` is the definition of a refused page reused below. scripts/audit/ia-date-check.mjs
 * judges IA *candidate* dates from IA metadata before import; nothing measured Hijri years already stored on
 * books. duplicate-fingerprint-groups.mjs finds duplicate BOOKS, not a leaf repeated inside one book. Nothing
 * counted served black page images.
 *
 * quality-sprint-classes — library-wide counts for the defect classes the quality-sprint spot checks keep
 * finding (#6056). Model-free, read-only on Mongo, writes files only.
 *
 *   node --env-file=.env.production.local scripts/audit/quality-sprint-classes.mjs pages --sample 1000 [--seed 6056] [--out DIR]
 *   node --env-file=.env.production.local scripts/audit/quality-sprint-classes.mjs hijri [--out DIR]
 *   node --env-file=.env.production.local scripts/audit/quality-sprint-classes.mjs black [--out DIR]
 *
 * pages  — a uniform per-BOOK sample of the public library (visible, pages_count > 0); `--all` walks every
 *          book. Per book, one indexed aggregation over its pages (never ocr.data itself, only its length):
 *            refusal_empty   OCR refused as recitation and the page still has < 20 chars of text (#4686)
 *            tr_placeholder  translation.recitation_blocked: the reader shows the "could not be translated" line
 *            dup_text        two consecutive pages with the same ocr.content_hash and > 200 chars: one leaf read
 *                            twice (I2), or one text written onto two leaves; either way a defect on sight
 *            nonpositive_page  soft-hidden records (page_number < 1): information only, never rendered (#3293)
 *          Checkpointed to books.jsonl per book, so a rerun resumes. Summary: books affected with a Wilson 95% CI
 *          and the projection to the frame.
 * hijri  — public Arabic-script books whose stored year is 1200–1450 (a Hijri year read as CE: 1402 AH = 1982)
 *          with a modern printing house or city in publisher/published/place. Lists them; never writes.
 * black  — public CADAL books on Internet Archive (identifier *.cn, the SKQS scans): fetches up to 3 page
 *          thumbnails per book; < 1,000 bytes is the black-image tell (a real thumbnail is ~20–30 KB), and
 *          mean luminance < 10 confirms.
 */
import { MongoClient } from 'mongodb';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [mode, ...args] = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', `scripts/eval/results/quality-sprint/${mode}-${new Date().toISOString().slice(0, 10)}`);
if (!['pages', 'hijri', 'black'].includes(mode)) { console.error('usage: quality-sprint-classes.mjs pages|hijri|black [...]'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const LIVE = { visible: true, pages_count: { $gt: 0 } };

function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const pct = (x) => `${(100 * x).toFixed(1)}%`;

// Seeded shuffle (mulberry32) over the sorted id list: uniform per book, reproducible.
function shuffle(arr, seed) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

async function pagesMode() {
  const ids = (await db.collection('books').find(LIVE, { projection: { _id: 0, id: 1 } }).toArray()).map((b) => b.id).filter(Boolean).sort();
  const frame = ids.length;
  // --books a,b,c: named books, for positive controls (a detector that cannot fire on a known case measures nothing).
  const sample = opt('books') ? opt('books').split(',') : args.includes('--all') ? ids : shuffle(ids, Number(opt('seed', 6056))).slice(0, Number(opt('sample', 1000)));
  const ckpt = join(OUT, 'books.jsonl');
  const done = new Map();
  if (existsSync(ckpt)) for (const l of readFileSync(ckpt, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); done.set(r.book_id, r); }
  console.log(`frame ${frame} public books · sample ${sample.length} · resuming with ${done.size} done`);
  const strLen = (f) => ({ $cond: [{ $eq: [{ $type: f }, 'string'] }, { $strLenCP: f }, 0] });
  let i = 0;
  for (const bookId of sample) {
    i++;
    if (done.has(bookId)) continue;
    let rows = await db.collection('pages').aggregate([
      { $match: { book_id: bookId } },
      { $project: { _id: 0, p: '$page_number', h: '$ocr.content_hash', n: strLen('$ocr.data'),
        rc: '$ocr.recitation_count', rb: '$ocr.recitation_blocked', skip: '$ocr.last_skip.reason', trb: '$translation.recitation_blocked' } },
      { $sort: { p: 1 } },
    ]).toArray();
    // Reader-facing classes count only pages a reader can reach: page_number <= 0 is the soft-hide convention
    // (scripts/lib/page-counts.mjs, #3293). Soft-hidden records are reported separately, as information, not a defect.
    const all = rows;
    rows = rows.filter((r) => typeof r.p === 'number' && r.p > 0);
    const refusal = rows.filter((r) => ((r.rc ?? 0) > 0 || r.rb === true || r.skip === 'recitation') && r.n < 20).map((r) => r.p);
    const trPlaceholder = rows.filter((r) => r.trb === true).map((r) => r.p);
    const dup = [];
    for (let k = 1; k < rows.length; k++) {
      const a = rows[k - 1], b = rows[k];
      if (a.h && a.h === b.h && a.n > 200 && b.n > 200) dup.push(b.p);
    }
    // Soft-hidden records (page_number < 1): NOT a reader defect — the reader never renders them (#3293). Counted so a
    // sampler that forgets the filter can be caught (the 2026-10-07 overview drew 6 of them).
    const nonpos = all.filter((r) => typeof r.p === 'number' && r.p < 1).map((r) => r.p);
    const rec = { book_id: bookId, pages: rows.length, refusal_empty: refusal.length, tr_placeholder: trPlaceholder.length, dup_text: dup.length, nonpositive_page: nonpos.length,
      ex: { refusal_empty: refusal.slice(0, 5), tr_placeholder: trPlaceholder.slice(0, 5), dup_text: dup.slice(0, 5), nonpositive_page: nonpos.slice(0, 5) } };
    appendFileSync(ckpt, JSON.stringify(rec) + '\n');
    done.set(bookId, rec);
    if (i % 100 === 0) console.log(`  ${i}/${sample.length}`);
  }
  const recs = sample.map((id) => done.get(id)).filter(Boolean);
  const summary = { frame_books: frame, sampled_books: recs.length, seed: Number(opt('seed', 6056)), classes: {} };
  for (const cls of ['refusal_empty', 'tr_placeholder', 'dup_text', 'nonpositive_page']) {
    const hit = recs.filter((r) => r[cls] > 0);
    const [lo, hi] = wilson(hit.length, recs.length);
    summary.classes[cls] = { books: hit.length, pages: hit.reduce((s, r) => s + r[cls], 0), rate: hit.length / recs.length, ci95: [lo, hi],
      projected_books: [Math.round(lo * frame), Math.round(hi * frame)],
      examples: hit.slice(0, 10).map((r) => `https://sourcelibrary.org/book/${r.book_id}?page=${r.ex[cls][0]}`) };
    console.log(`${cls.padEnd(15)} ${hit.length}/${recs.length} books (${pct(hit.length / recs.length)}, CI ${pct(lo)}–${pct(hi)}) · ${summary.classes[cls].pages} pages · ≈ ${summary.classes[cls].projected_books.join('–')} public books`);
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
}

async function hijriMode() {
  // Languages written in Arabic script in this corpus (Malay included: the Leiden Jawi MSS carry Hijri years too).
  const ARABIC_SCRIPT = /arab|pers|farsi|ottoman|urdu|pashto|kurd|malay|jawi|sindhi/i;
  const MODERN = /beirut|bayr[uū]t|بيروت|cairo|al-q[aā]hira|القاهرة|b[uū]l[aā]q|بولاق|teh?r[aā]n|طهران|qom|qum|قم|damascus|dimashq|دمشق|riyadh|الرياض|baghdad|بغداد|karachi|lahore|lucknow|hyderabad|istanbul|i̇stanbul|dar al-|dār al-|دار |maktaba|مكتبة|matba|مطبعة|press|verlag|beyrouth|le caire/i;
  const books = await db.collection('books').find({ ...LIVE, language: ARABIC_SCRIPT },
    { projection: { _id: 0, id: 1, title: 1, language: 1, year: 1, published: 1, publisher: 1, place_of_publication: 1, place_published: 1, publication_place: 1, format: 1 } }).toArray();
  const yearOf = (b) => (typeof b.year === 'number' ? b.year : Number((String(b.published ?? '').match(/\b(1[0-9]{3})\b/) || [])[1]) || null);
  const inRange = books.filter((b) => { const y = yearOf(b); return y && y >= 1200 && y <= 1450; });
  // Classes, most certain first:
  //   hijri_bracketed   `published` carries the CE year in brackets ("1303 [1885]") and `year` holds the Hijri one
  //   modern_published  `published` names a year ≥ 1800 while `year` is 1200–1450 (a composition date as edition date)
  //   modern_imprint    a modern printing city or house in the imprint fields (Iḥyāʾ: Beirut, Dār al-Maʿrifah, "1402")
  //   unproven          a year in range with no edition evidence either way — composition date or a real MS date; by eye
  const rows = inRange.map((b) => {
    const where = [b.publisher, b.published, b.place_of_publication, b.place_published, b.publication_place].filter(Boolean).join(' | ');
    const pub = String(b.published ?? '');
    const bracket = pub.match(/\[(1[6-9]\d{2}|20\d{2})/);
    const modernYear = (pub.match(/\b(1[89]\d{2}|20\d{2})\b/) || [])[1];
    const cls = bracket ? 'hijri_bracketed' : modernYear ? 'modern_published' : MODERN.test(where) ? 'modern_imprint' : 'unproven';
    return { id: b.id, class: cls, year: yearOf(b), ce_year: bracket ? Number(bracket[1]) : modernYear ? Number(modernYear) : null, language: b.language,
      where: where.slice(0, 160), title: String(b.title).slice(0, 80), url: `https://sourcelibrary.org/book/${b.id}` };
  });
  const byClass = Object.fromEntries(['hijri_bracketed', 'modern_published', 'modern_imprint', 'unproven'].map((c) => [c, rows.filter((r) => r.class === c).length]));
  writeFileSync(join(OUT, 'hijri-candidates.json'), JSON.stringify({ arabic_script_public: books.length, year_1200_1450: rows.length, by_class: byClass, rows }, null, 2));
  console.log(`Arabic-script public books ${books.length} · year 1200–1450: ${rows.length} · ${JSON.stringify(byClass)}`);
}

async function blackMode() {
  const { default: sharp } = await import('sharp');
  const all = (await db.collection('books').find({ ...LIVE, 'image_source.provider': 'internet_archive', 'image_source.identifier': /\.cn$/ },
    { projection: { _id: 0, id: 1, title: 1, pages_count: 1 } }).toArray()).sort((a, b) => (a.id < b.id ? -1 : 1));
  // 12.6K books × 3 fetches is hours from a laptop: default to a uniform sample (--sample N), --all for the census.
  const books = opt('books') ? all.filter((b) => opt('books').split(',').includes(b.id)) : args.includes('--all') ? all : shuffle(all, Number(opt('seed', 6056))).slice(0, Number(opt('sample', 600)));
  console.log(`CADAL (.cn) public books: ${all.length} · checking ${books.length}`);
  const rows = [];
  for (const b of books) {
    const picks = [...new Set([2, Math.ceil(b.pages_count / 2), b.pages_count - 1].filter((p) => p >= 1 && p <= b.pages_count))];
    const pages = await db.collection('pages').find({ book_id: b.id, page_number: { $in: picks } }, { projection: { _id: 0, page_number: 1, thumbnail_blob: 1, display_photo: 1 } }).toArray();
    let black = 0; const ex = [];
    for (const p of pages) {
      const url = p.thumbnail_blob || p.display_photo;
      if (!url) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length >= 1000) continue;
        const { channels } = await sharp(buf).stats();
        const lum = channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / Math.min(3, channels.length);
        if (lum < 10) { black++; ex.push(p.page_number); }
      } catch { /* unreadable thumbnail: not counted either way */ }
    }
    rows.push({ id: b.id, title: String(b.title).slice(0, 70), checked: pages.length, black, ex, url: `https://sourcelibrary.org/book/${b.id}?page=${ex[0] ?? 1}` });
  }
  const hit = rows.filter((r) => r.black > 0);
  const allBlack = rows.filter((r) => r.checked && r.black === r.checked);
  const [lo, hi] = wilson(hit.length, books.length);
  writeFileSync(join(OUT, 'black-images.json'), JSON.stringify({ cadal_public: all.length, checked: books.length, books_with_black: hit.length, ci95: [lo, hi],
    projected_books: [Math.round(lo * all.length), Math.round(hi * all.length)], all_checked_black: allBlack.length, rows }, null, 2));
  console.log(`books with ≥1 black page of 3 checked: ${hit.length}/${books.length} (CI ${pct(lo)}–${pct(hi)}, ≈ ${Math.round(lo * all.length)}–${Math.round(hi * all.length)} of ${all.length}) · all checked pages black: ${allBlack.length}`);
}

try {
  if (mode === 'pages') await pagesMode();
  else if (mode === 'hijri') await hijriMode();
  else await blackMode();
  console.log(`wrote ${OUT}`);
} finally {
  await client.close();
}
