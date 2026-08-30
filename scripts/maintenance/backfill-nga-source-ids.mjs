#!/usr/bin/env node
/**
 * Match the NGA-provider artwork docs against the National Gallery of Art
 * open-data catalog and write `source_ids.nga` (#3838, item 3).
 *
 * The 590 `image_source.provider: "nga"` docs carry no structured source
 * pointer at all — `image_source.identifier` is an internal import counter
 * ("nga-11"), not an NGA id. NGA has no live public API; the authoritative
 * source is their open-data CSV dump (github.com/NationalGalleryOfArt/opendata).
 *
 * Matching is deliberately STRICT — a wrong id is worse than none (#3815):
 *   1. normalized(title) + normalized(attribution) must hit exactly ONE
 *      catalog object (attribution or attributioninverted, doc title or
 *      display_title);
 *   2. fallback: normalized title unique in the whole catalog AND the
 *      attribution contains the author's last name.
 * Anything ambiguous or unmatched is reported, never guessed. Existing
 * `source_ids.nga` values are never overwritten.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-nga-source-ids.mjs \
 *     --objects-csv=/path/to/objects.csv \
 *     [--images-csv=/path/to/published_images.csv] [--dry-run]
 *
 * CSVs: curl -sL -o objects.csv https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/objects.csv
 *       (published_images.csv likewise; optional — only used to report IIIF
 *       coverage of the matches for the item-5 fetcher.)
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import readline from 'readline';

const DRY_RUN = process.argv.includes('--dry-run');
const argVal = (name) => process.argv.find(a => a.startsWith(`${name}=`))?.split('=').slice(1).join('=');
const OBJECTS_CSV = argVal('--objects-csv');
const IMAGES_CSV = argVal('--images-csv');
if (!OBJECTS_CSV) { console.error('--objects-csv=... required'); process.exit(2); }

// Minimal RFC-4180 CSV line stream: handles quoted fields, embedded commas,
// escaped quotes, and newlines inside quotes.
async function* csvRows(path) {
  const rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });
  let pending = '';
  for await (const line of rl) {
    pending = pending ? pending + '\n' + line : line;
    // A row is complete when it contains an even number of unescaped quotes.
    if (((pending.match(/"/g) || []).length % 2) !== 0) continue;
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < pending.length; i++) {
      const ch = pending[i];
      if (inQ) {
        if (ch === '"') { if (pending[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { fields.push(cur); cur = ''; }
      else cur += ch;
    }
    fields.push(cur);
    pending = '';
    yield fields;
  }
}

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(2); }

  console.log('Loading NGA objects catalog…');
  const byTitleAttr = new Map(); // norm(title)|norm(attr) -> Set(objectid)
  const byTitle = new Map();     // norm(title) -> [{objectid, attribution}]
  let header = null, nRows = 0;
  for await (const row of csvRows(OBJECTS_CSV)) {
    if (!header) { header = row; continue; }
    const get = (name) => row[header.indexOf(name)];
    const objectid = get('objectid');
    const title = get('title');
    if (!objectid || !title) continue;
    nRows++;
    const nt = norm(title);
    const attrs = [get('attribution'), get('attributioninverted')].filter(Boolean);
    for (const a of attrs) {
      const k = `${nt}|${norm(a)}`;
      if (!byTitleAttr.has(k)) byTitleAttr.set(k, new Set());
      byTitleAttr.get(k).add(objectid);
    }
    if (!byTitle.has(nt)) byTitle.set(nt, []);
    byTitle.get(nt).push({ objectid, attribution: attrs[0] || '' });
  }
  console.log(`${nRows} catalog objects loaded`);

  let iiifByObject = null;
  if (IMAGES_CSV) {
    iiifByObject = new Set();
    let ih = null;
    for await (const row of csvRows(IMAGES_CSV)) {
      if (!ih) { ih = row; continue; }
      const oid = row[ih.indexOf('depictstmsobjectid')];
      if (oid) iiifByObject.add(oid);
    }
    console.log(`${iiifByObject.size} objects have published IIIF images`);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const books = client.db('bookstore').collection('books');
  const docs = await books.find(
    { resource_type: { $exists: true }, 'image_source.provider': 'nga', 'source_ids.nga': { $exists: false } },
    { projection: { _id: 1, id: 1, slug: 1, title: 1, display_title: 1, author: 1 } }
  ).toArray();
  console.log(`${docs.length} NGA docs without source_ids.nga\n`);

  const stats = { matched: 0, matchedFallback: 0, ambiguous: 0, unmatched: 0, withIiif: 0 };
  const problems = [];
  const ops = [];

  for (const doc of docs) {
    const titles = [...new Set([doc.title, doc.display_title].filter(Boolean))];
    const na = norm(doc.author);
    let hit = null, how = null;

    const exact = new Set();
    for (const t of titles) {
      const s = byTitleAttr.get(`${norm(t)}|${na}`);
      if (s) for (const id of s) exact.add(id);
    }
    if (exact.size === 1) { hit = [...exact][0]; how = 'title+attribution'; }
    else if (exact.size > 1) { stats.ambiguous++; problems.push({ id: doc.id || String(doc._id), slug: doc.slug, why: 'ambiguous', candidates: [...exact] }); continue; }
    else {
      // Fallback: unique title in the whole catalog + last-name check.
      const lastName = norm((doc.author || '').trim().split(/\s+/).pop());
      const cands = titles.flatMap(t => byTitle.get(norm(t)) || []);
      const uniq = [...new Map(cands.map(c => [c.objectid, c])).values()];
      if (uniq.length === 1 && lastName && norm(uniq[0].attribution).includes(lastName)) {
        hit = uniq[0].objectid; how = 'unique-title+lastname';
      } else if (uniq.length > 1) { stats.ambiguous++; problems.push({ id: doc.id || String(doc._id), slug: doc.slug, why: 'ambiguous-title-only', candidates: uniq.map(u => u.objectid).slice(0, 8) }); continue; }
      else { stats.unmatched++; problems.push({ id: doc.id || String(doc._id), slug: doc.slug, why: 'no-match', title: doc.title, author: doc.author }); continue; }
    }

    if (how === 'title+attribution') stats.matched++; else stats.matchedFallback++;
    if (iiifByObject?.has(hit)) stats.withIiif++;
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { 'source_ids.nga': hit } } } });
  }

  if (ops.length && !DRY_RUN) {
    const r = await books.bulkWrite(ops, { ordered: false });
    console.log(`bulkWrite modified ${r.modifiedCount}`);
  }

  console.log('\n━━━ SUMMARY ━━━');
  console.log(JSON.stringify(stats, null, 2));
  const outPath = `scripts/output/nga-source-ids-backfill-${new Date().toISOString().slice(0, 10)}.json`;
  fs.mkdirSync('scripts/output', { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), dry_run: DRY_RUN, stats, problems }, null, 2));
  console.log(`Report → ${outPath}`);
  await client.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
