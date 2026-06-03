#!/usr/bin/env node
/**
 * Backfill commons_width/commons_height for artworks whose image lives on an
 * external IIIF server (Leiden, UMedia, Allard Pierson, …) and whose docs
 * never stored dimensions. ~514 visible artworks as of 2026-06-03.
 *
 * Reads the IIIF info.json next to the image (strip /{region}/{size}/{rot}/
 * default.jpg → /info.json) and stores the full canvas width/height. These
 * works are full IIIF sources, so they're "unknown", not low-res — this fixes
 * the data so resolution audits stop counting them as unknowns.
 *
 * NOTE: Leiden's IIIF rate-limits some IPs — run this from the Hetzner box if
 * local fetches return empty.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-iiif-artwork-dimensions.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function infoJsonUrl(imageUrl) {
  // IIIF Image API: {base}/{region}/{size}/{rotation}/default.{fmt}
  const m = String(imageUrl || '').match(/^(.*)\/[^/]+\/[^/]+\/[^/]+\/default\.(?:jpg|jpeg|png|webp)$/);
  return m ? `${m[1]}/info.json` : null;
}

const client = new MongoClient(process.env.MONGODB_URI);

async function main() {
  await client.connect();
  const books = client.db('bookstore').collection('books');
  const docs = await books.find({
    content_type: 'artwork', visible: true,
    $or: [{ commons_width: { $exists: false } }, { commons_width: null }],
  }, { projection: { image_display: 1, thumbnail: 1, 'image_source.provider': 1 } }).toArray();

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}${docs.length} visible artworks without stored dimensions`);
  let set = 0, noIiif = 0, errors = 0, n = 0;
  const ops = [];

  for (const d of docs) {
    n++;
    const info = infoJsonUrl(d.image_display) || infoJsonUrl(d.thumbnail);
    if (!info) { noIiif++; continue; }
    try {
      const res = await fetch(info, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) { errors++; continue; }
      const j = await res.json();
      if (j.width && j.height) {
        ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { commons_width: j.width, commons_height: j.height, updated_at: new Date() } } } });
        set++;
      } else { errors++; }
    } catch { errors++; }
    if (n % 100 === 0) console.log(`  ${n}/${docs.length} set:${set} noIiif:${noIiif} err:${errors}`);
    await sleep(150);
  }

  if (!DRY_RUN && ops.length) await books.bulkWrite(ops, { ordered: false });
  console.log(`\nDONE. dims set:${set} | not IIIF-shaped:${noIiif} | errors:${errors}`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
