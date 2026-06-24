/**
 * assign-work-slugs.mjs — clean human-readable URL slug per work.
 *
 * work_id is the stable internal join key (e.g. local:a:agrippa:…, or a Wikidata
 * QID) — fine for joins, ugly in a URL (/work/local%3Aa%3A…). This adds a
 * separate `work_slug` derived from the curated work_title (+ author surname for
 * readability/uniqueness), so /work/agrippa-de-occulta-philosophia-libri-tres
 * resolves. The route accepts EITHER work_slug or work_id (back-compat).
 *
 *   node scripts/analysis/assign-work-slugs.mjs            # dry-run, sample
 *   node scripts/analysis/assign-work-slugs.mjs --apply    # write work_slug (+backup)
 *
 * Idempotent: deterministic slug per work_id; re-running is a no-op. Reversible
 * (work_slug is an additive field; unset to roll back). Refs #1634.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const deacc = s => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slugify = s => deacc(s).replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
function surname(author) {
  let a = deacc(author).replace(/\(.*?\)/g, '').replace(/[^a-z ,]/g, ' ').trim();
  if (a.includes(',')) return a.split(',')[0].trim().split(/\s+/).pop() || '';
  const p = a.split(/\s+/).filter(Boolean);
  return p[p.length - 1] || '';
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
await mc.connect();
const b = mc.db('bookstore').collection('books');

const rows = await b.find(
  { work_id: { $exists: true, $ne: null } },
  { projection: { id: 1, work_id: 1, work_title: 1, title: 1, display_title: 1, author: 1 } }
).toArray();

// group by work_id; pick representative title + author
const works = new Map();
for (const r of rows) {
  if (!works.has(r.work_id)) works.set(r.work_id, { titles: new Map(), authors: new Map(), books: 0 });
  const w = works.get(r.work_id);
  w.books++;
  const t = (r.work_title || r.display_title || r.title || '').trim();
  if (t) w.titles.set(t, (w.titles.get(t) || 0) + 1);
  if (r.author) w.authors.set(r.author, (w.authors.get(r.author) || 0) + 1);
}
const top = m => [...m.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] || '';

// assign slugs deterministically (sort work_ids for stable collision suffixes)
const taken = new Map();   // slug -> work_id (first claimant)
const assign = new Map();  // work_id -> work_slug
for (const wid of [...works.keys()].sort()) {
  const w = works.get(wid);
  const title = top(w.titles), author = top(w.authors);
  const sn = surname(author);
  let base = slugify(title);
  if (sn && !base.includes(slugify(sn))) base = `${slugify(sn)}-${base}`.slice(0, 80).replace(/-+$/, '');
  if (!base) base = slugify(wid.split(':').pop() || wid) || 'work';
  let slug = base, n = 1;
  while (taken.has(slug) && taken.get(slug) !== wid) { n++; slug = `${base}-${n}`; }
  taken.set(slug, wid);
  assign.set(wid, slug);
}

console.log(`works: ${works.size} | books with work_id: ${rows.length}`);
const multi = [...works.entries()].filter(([, w]) => w.books > 1);
console.log(`multi-edition works (the ones that get /work links): ${multi.length}`);
console.log('\n── sample slugs (multi-edition works) ──');
for (const [wid, w] of multi.sort((a, b) => b[1].books - a[1].books).slice(0, 14)) {
  console.log(`  /work/${assign.get(wid)}   (${w.books} eds) — "${top(w.titles).slice(0, 50)}"`);
}

const outDir = new URL('../output/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}work-slug-assignments.json`, JSON.stringify([...assign.entries()].map(([work_id, work_slug]) => ({ work_id, work_slug })), null, 2));
console.log(`\nassignments → ${outDir}work-slug-assignments.json`);

if (APPLY) {
  let mod = 0, i = 0;
  for (const [wid, slug] of assign) {
    const r = await b.updateMany({ work_id: wid }, { $set: { work_slug: slug } });
    mod += r.modifiedCount;
    if (++i % 2000 === 0) console.log(`  ${i}/${assign.size} works...`);
  }
  console.log(`\n--apply: ${mod} book records got work_slug across ${assign.size} works`);
}

await mc.close();
