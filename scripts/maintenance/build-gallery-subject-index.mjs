#!/usr/bin/env node
/**
 * PRIOR ART: `scripts/compute-iconclass-tree.mjs` precomputed the page's old Iconclass
 * axis in the same shape — aggregate, pick a representative thumbnail, write one config
 * doc the ISR page reads. Iconclass was retired as navigation in #5012. The previous
 * version of THIS script counted raw `metadata.subjects` strings with no vocabulary, so
 * "botany", "herbalism", "flora" and "medicinal plants" were four separate tiles.
 *
 * Build the picture-subject index behind /browse/subjects (#4856).
 *
 * WHAT IT COUNTS
 * The vocabulary in `src/data/image-subjects.json` (categories → terms, in a reader's
 * words) and the reviewed map in `src/data/image-subject-map.json` (raw extractor
 * string → term ids). For every category and term, the index records:
 *   - `count`: DISTINCT visible images whose `metadata.subjects` contains any raw
 *     string mapped to it. This is a count of pictures, not of subject tags, so an
 *     image tagged "botany" and "herbalism" counts once under Plants.
 *   - `book_count`: distinct books those images come from.
 *   - `thumbnail`: the best-scoring picture, not reused by an earlier tile.
 * `covered_images` is the number of visible images that land in at least one
 * category, so the page can say honestly how much of the collection the browse reaches.
 *
 * Every query is `metadata.subjects: {$in: …}`, which the `metadata.subjects` index serves.
 * NEVER writes to `books`, `pages` or `gallery_images`; one `system_config` document.
 *
 * Runs nightly on Hetzner (infrastructure/hetzner-crontab) so new extractions appear.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/build-gallery-subject-index.mjs
 *   … --dry-run   print the index, write nothing
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DRY = process.argv.includes('--dry-run');
const DOC_ID = 'gallery_subject_index';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/image-subjects.json'), 'utf8'));
const subjectMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/image-subject-map.json'), 'utf8')).map;

const rawByTerm = new Map();
for (const [raw, ids] of Object.entries(subjectMap)) {
  for (const id of ids) rawByTerm.set(id, [...(rawByTerm.get(id) ?? []), raw]);
}
const rawFor = (termIds) => [...new Set(termIds.flatMap((id) => rawByTerm.get(id) ?? []))];

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const gallery = client.db('bookstore').collection('gallery_images');
  const base = { book_visible: true, extracted_url: { $ne: null } };
  const usedThumbs = new Set();

  async function stats(raws) {
    if (raws.length === 0) return { count: 0, book_count: 0, thumbnail: null };
    const match = { ...base, 'metadata.subjects': { $in: raws } };
    // Thumbnail: prefer pictures whose FIRST subject is in this topic. Ranking on
    // gallery_quality alone picked allegorical frontispieces that mention everything
    // (a world map for Emblems, a title-page allegory for Plants).
    const primary = { ...match, 'metadata.subjects.0': { $in: raws } };
    const [count, books, primaryTop, anyTop] = await Promise.all([
      gallery.countDocuments(match, { maxTimeMS: 300000 }),
      gallery.aggregate([{ $match: match }, { $group: { _id: '$book_id' } }, { $count: 'n' }], { maxTimeMS: 300000 }).toArray(),
      gallery.find(primary, { projection: { thumbnail_url: 1, extracted_url: 1 } })
        .sort({ gallery_quality: -1 }).limit(25).toArray(),
      gallery.find(match, { projection: { thumbnail_url: 1, extracted_url: 1 } })
        .sort({ gallery_quality: -1 }).limit(25).toArray(),
    ]);
    const top = [...primaryTop, ...anyTop];
    const pick = top.find((d) => !usedThumbs.has(d.thumbnail_url || d.extracted_url)) ?? top[0];
    const thumbnail = pick ? (pick.thumbnail_url || pick.extracted_url) : null;
    if (thumbnail) usedThumbs.add(thumbnail);
    return { count, book_count: books[0]?.n ?? 0, thumbnail };
  }

  const visible = await gallery.countDocuments(base);
  const covered = await gallery.countDocuments({ ...base, 'metadata.subjects': { $in: Object.keys(subjectMap).filter((k) => subjectMap[k].length) } });
  console.log(`visible images: ${visible}; in at least one category: ${covered} (${(100 * covered / visible).toFixed(1)}%)`);

  // A hand-picked tile picture (`featured_image`, a gallery_images id) wins over the
  // automatic pick — some categories' best-scoring images read badly as a tile
  // (Fludd's solid black "primeval void" for Astronomy). Reserve them first so no
  // other tile reuses them.
  const featured = new Map();
  for (const cat of vocab.categories) {
    if (!cat.featured_image) continue;
    const doc = await gallery.findOne({ id: cat.featured_image }, { projection: { thumbnail_url: 1, extracted_url: 1 } });
    const url = doc && (doc.thumbnail_url || doc.extracted_url);
    if (url) { featured.set(cat.id, url); usedThumbs.add(url); }
    else console.warn(`featured_image ${cat.featured_image} for ${cat.id} not found — using the automatic pick`);
  }

  const categories = [];
  for (const cat of vocab.categories) {
    const catStats = await stats(rawFor(cat.terms.map((t) => t.id)));
    if (featured.has(cat.id)) catStats.thumbnail = featured.get(cat.id);
    const terms = [];
    for (const t of cat.terms) {
      const s = await stats(rawFor([t.id]));
      if (s.count > 0) terms.push({ id: t.id, label: t.label, ...s });
    }
    terms.sort((a, b) => b.count - a.count);
    categories.push({ id: cat.id, label: cat.label, ...catStats, terms });
    console.log(`${cat.label}: ${catStats.count} images, ${catStats.book_count} books — ${terms.map((t) => `${t.label} ${t.count}`).join(', ')}`);
  }
  categories.sort((a, b) => b.count - a.count);

  if (DRY) { console.log('\n(dry run — nothing written)'); await client.close(); return; }

  const res = await client.db('bookstore').collection('system_config').updateOne(
    { _id: DOC_ID },
    {
      $set: {
        categories,
        total_images: visible,
        covered_images: covered,
        updated_at: new Date(),
        source: 'scripts/maintenance/build-gallery-subject-index.mjs (#4856)',
      },
      // `terms` / `indexed_images` / `min_count` are the previous version's raw-string
      // tiles. They are left in place, not $unset, so a deploy that still reads them
      // keeps working while this change rolls out; nothing on main reads them.
    },
    { upsert: true },
  );
  console.log(`wrote system_config.${DOC_ID}: ${categories.length} categories (matched ${res.matchedCount}, modified ${res.modifiedCount}, upserted ${res.upsertedCount})`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
