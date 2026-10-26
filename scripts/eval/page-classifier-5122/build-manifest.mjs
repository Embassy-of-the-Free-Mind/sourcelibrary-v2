#!/usr/bin/env node
// PRIOR ART: scripts/audit/spread-screen.mjs (leaf count from the STORED aspect ratio, books only, no image read —
// kept here as the baseline arm), scripts/lib/paddle-table-detect.mjs (table risk from Paddle TEXT, after the read),
// scripts/gpu/gex45-bench-6871/build-manifest.mjs (one random page per book for a speed card; no labels). None
// joins the label sets we already hold to the page images, which a pre-read classifier is scored on (#5122).
//
// Builds the labelled page manifest for the pre-read page classifier pilot (#5122). READ ONLY: Mongo reads and the
// committed benchmark files; nothing is written to any store. Output: one JSON line per page.
//   node --env-file=.env.production.local scripts/eval/page-classifier-5122/build-manifest.mjs --out $JOB_SCRATCH/manifest.jsonl
// Sets (label source → what it labels):
//   bench    scripts/eval/benchmark/*.json sealed pages → script (Unicode census of the by-eye / corrected reference in
//            refs/ where one exists = gold; else of the stored OCR = silver, training only), script-class/ spread → leaves
//   dd4763   english-ia-5124 rows with observed.by → kind date-dense | prose (#4763)
//   tab6561  paddle_table_corrections_6561 Opus layout call → kind table | prose | mixed | diagram | plate (#6561);
//            script from the Opus-corrected text
//   music    music_transcriptions pages → kind music
//   frames   split-leaves-5771 pilot frames (two-leaf pecha frames) → leaves 2 (#5771/#6948)
//   usplit   split_training_examples (a user split the image) → leaves 2
//   check    a fresh random draw for the Opus by-eye check set (no label here; labelled by label-check.sh)
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out'); if (!OUT) { console.error('--out required'); process.exit(2); }
const FRAMES = arg('frames', '/root/jobs/split-leaves-5771/frames.jsonl');
const SEED = Number(arg('seed', 5122));
const BENCH = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'benchmark');

let s = SEED >>> 0; // mulberry32, so the draw is reproducible against the same data
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// the image the reader (and so the OCR) gets: the crop of a split page, else the archived master, else the source
const imageOf = (p) => (p.crop && p.cropped_photo) || p.archived_photo || p.photo || null;

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const pages = db.collection('pages');
const out = [];
const add = (r) => out.push(r);
const PROJ = { projection: { id: 1, book_id: 1, page_number: 1, crop: 1, cropped_photo: 1, archived_photo: 1, photo: 1 } };

// ── bench: every sealed page that has a reference text in refs/
const refs = new Set(fs.readdirSync(path.join(BENCH, 'refs')).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4)));
const spread = new Map();
for (const f of fs.readdirSync(path.join(BENCH, 'script-class'))) {
  // a file holds one object, or several, one per line
  for (const line of fs.readFileSync(path.join(BENCH, 'script-class', f), 'utf8').split('\n').filter((l) => l.trim())) {
    const d = JSON.parse(line);
    if (typeof d.spread === 'boolean') spread.set(d.slug, d);
  }
}
const seen = new Set();
for (const f of fs.readdirSync(BENCH).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(BENCH, f), 'utf8'));
  const rows = [d.pages, d.rows].filter(Array.isArray).flat();
  for (const r of rows) {
    if (!r.slug || seen.has(r.slug)) continue;
    seen.add(r.slug);
    let url = r.image_url?.trim() || null;
    // the stored OCR, for a SILVER script label (Unicode census) where no reference exists; training only, never scored
    const p = r.book_id && r.page_number != null
      ? await pages.findOne({ book_id: r.book_id, page_number: r.page_number }, { projection: { ...PROJ.projection, 'ocr.data': 1 } }) : null;
    if (!url && p) url = imageOf(p);
    if (!url) continue;
    const stored_ocr = refs.has(r.slug) ? null : (p?.ocr?.data || '').slice(0, 4000) || null;
    const sc = spread.get(r.slug);
    add({ uid: `bench:${r.slug}`, set: 'bench', file: f, book_id: r.book_id, page_number: r.page_number, image_url: url,
      catalogue_language: r.language ?? null, year: r.year ?? null,
      ref: refs.has(r.slug) ? `refs/${r.slug}.txt` : null, stored_ocr,
      labels: sc ? { leaves: sc.spread ? 2 : 1, script_class: sc.script_class } : {},
      label_src: sc ? `script-class/${r.slug}.json (${sc.classified_by})` : refs.has(r.slug) ? 'refs (script by Unicode census)' : 'stored OCR (silver)' });
  }
}

// ── dd4763: date-dense vs prose, English 1800–1930 (#4763 strata)
for (const r of JSON.parse(fs.readFileSync(path.join(BENCH, 'english-ia-5124.json'), 'utf8')).rows) {
  if (!r.image_url || !r.observed?.by) continue;
  add({ uid: `dd4763:${r.slug}`, set: 'dd4763', book_id: r.book_id, page_number: r.page_number, image_url: r.image_url,
    catalogue_language: 'English', year: r.catalogue?.published ?? null,
    labels: { kind: r.observed.date_dense ? 'date-dense' : 'prose', script: 'Latn' },
    label_src: `english-ia-5124 observed (${r.observed.by}, ${r.observed.at}; rule ${r.stratum})` });
}

// ── tab6561: Opus layout calls on Paddle-flagged Chinese pages
const KIND = { table: 'table', prose: 'prose', mixed: 'mixed', diagram: 'diagram', illustration: 'plate', map: 'plate' };
const want = { table: 300, prose: 300, mixed: 120, diagram: 120, illustration: 16, map: 2 };
for (const [layout, n] of Object.entries(want)) {
  const rows = await db.collection('paddle_table_corrections_6561')
    .aggregate([{ $match: { layout } }, { $sample: { size: n } }, { $project: { page_id: 1, book_id: 1, page_number: 1, image_url: 1, corrected_text: 1 } }]).toArray();
  for (const r of rows) add({ uid: `tab6561:${r.page_id}`, set: 'tab6561', page_id: r.page_id, book_id: r.book_id, page_number: r.page_number,
    image_url: r.image_url, catalogue_language: 'Chinese', labels: { kind: KIND[layout] },
    // script is NOT assumed from the catalogue: 172 of these "Chinese" pages are Manchu (御製增訂清文鑑). It is the
    // Unicode census of Opus's corrected text (made with the image in), computed in labels.py
    ref_text: (r.corrected_text || '').slice(0, 6000) || null,
    label_src: `paddle_table_corrections_6561 layout=${layout} (Opus, image in); script = Unicode census of the Opus-corrected text` });
}

// ── music: pages a verified or draft transcription was read from
const mpages = new Set();
for (const m of await db.collection('music_transcriptions').find({}, { projection: { page_id: 1, spans_pages: 1 } }).toArray())
  for (const id of [m.page_id, ...(m.spans_pages || [])]) if (id) mpages.add(id);
for (const p of await pages.find({ id: { $in: [...mpages] } }, PROJ).toArray()) {
  const url = imageOf(p); if (!url) continue;
  add({ uid: `music:${p.id}`, set: 'music', page_id: p.id, book_id: p.book_id, page_number: p.page_number, image_url: url,
    labels: { kind: 'music' }, label_src: 'music_transcriptions (score read from this page)' });
}

// ── frames: two-leaf pecha frames from the split-leaves pilot
if (fs.existsSync(FRAMES)) for (const line of fs.readFileSync(FRAMES, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line); const n = (r.spans || []).length || 2;
  add({ uid: `frames:${r.page_id}`, set: 'frames', page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, image_url: r.src,
    catalogue_language: 'Tibetan', labels: { leaves: n, script: 'Tibt' }, label_src: `split-leaves-5771 frames.jsonl (${r.cut_source})` });
}

// ── usplit: images a user split by hand
for (const r of await db.collection('split_training_examples').aggregate([{ $sample: { size: 250 } }]).toArray())
  add({ uid: `usplit:${r.pageId}`, set: 'usplit', page_id: r.pageId, book_id: r.bookId, image_url: r.imageUrl,
    labels: { leaves: 2 }, label_src: 'split_training_examples (user_split)' });

// ── check: fresh draw for the Opus by-eye set — 50 uniform books + 50 books whose catalogue language is not Latin-script
const NONLATIN = /chinese|japanese|korean|arabic|persian|urdu|ottoman|hebrew|yiddish|aramaic|syriac|greek|tibetan|sanskrit|hindi|bengali|pali|armenian|georgian|russian|church slavonic|cyrillic|ge.?ez|ethiopic|coptic|mongol|manchu|thai|burmese|tamil|javanese|^zh|^ja|^ar|^he|^grc|^el|^bo|^sa/i;
const used = new Set(out.map((r) => r.book_id));
async function draw(match, n, tag) {
  const books = await db.collection('books').aggregate([{ $match: { visible: true, pages_count: { $gt: 8 }, ...match } }, { $sample: { size: n * 4 } },
    { $project: { id: 1, pages_count: 1, language: 1, published: 1 } }]).toArray();
  let k = 0;
  for (const b of books) {
    if (k >= n || used.has(b.id)) continue;
    const pn = 1 + Math.floor(b.pages_count * (0.1 + 0.8 * rnd()));
    const p = await pages.findOne({ book_id: b.id, page_number: pn }, PROJ);
    const url = p && imageOf(p); if (!url) continue;
    used.add(b.id); k++;
    add({ uid: `check:${p.id}`, set: 'check', stratum: tag, page_id: p.id, book_id: b.id, page_number: pn, image_url: url,
      catalogue_language: b.language ?? null, year: b.published ?? null, labels: {}, label_src: 'opus by eye (label-check)' });
  }
}
await draw({}, 50, 'uniform');
await draw({ language: { $regex: NONLATIN.source, $options: 'i' } }, 50, 'nonlatin-catalogue');

fs.writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
const tally = {}; for (const r of out) tally[r.set] = (tally[r.set] || 0) + 1;
console.log(OUT, out.length, tally);
await c.close();
