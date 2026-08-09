#!/usr/bin/env node
/**
 * Backfill structured provider ids from the doc's own source link
 * (#3838, items 2–3 groundwork).
 *
 * Many artwork docs carry a museum's own record URL in `commons_url` /
 * `source_url` (the fields are generic source links — see
 * scripts/lib/artwork-sources.mjs) but no structured `source_ids.*`. The id
 * is embedded in the URL, so extraction is purely mechanical:
 *
 *   - Met:  https://www.metmuseum.org/art/collection/search/436529
 *           → source_ids.met = "436529"  (objectID; live API lookup exists,
 *           so these docs immediately become verifiable by
 *           scripts/audit/artwork-image-integrity.mjs)
 *   - Rijksmuseum:
 *           https://www.rijksmuseum.nl/nl/collectie/object/RP-P-OB-1482--<hex>
 *           → source_ids.rijksmuseum = "RP-P-OB-1482"  (object number;
 *           stable id for when a Linked Art fetcher lands — the old API is
 *           410 Gone)
 *
 * Extraction is faithful-to-source: the value written is the museum's own
 * identifier from the museum's own URL, never derived from our slug or
 * title. Docs whose URL doesn't parse are reported, not guessed at.
 * Existing `source_ids.*` values are never overwritten.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-provider-source-ids.mjs [--dry-run] [--limit=N]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10) || 0;

function sourceLinks(doc) {
  return [doc.source_url, doc.commons_url].filter(Boolean);
}

function extractMet(doc) {
  for (const u of sourceLinks(doc)) {
    const m = u.match(/metmuseum\.org\/art\/collection\/search\/(\d+)/i);
    if (m) return m[1];
  }
  return null;
}

// Object number = last path segment, minus the trailing "--<hex>" share-hash
// the Rijksmuseum site appends. Keeps dots, hyphens, and (R)/(V) markers.
const RIJKS_OBJNUM = /^[A-Z]{1,4}-[A-Za-z0-9.()-]+$/;
function extractRijks(doc) {
  for (const u of sourceLinks(doc)) {
    if (!/rijksmuseum\.nl/i.test(u)) continue;
    const m = u.match(/\/(?:collectie|collection)\/object\/([^/?#]+)/i);
    if (!m) continue;
    let objnum;
    try { objnum = decodeURIComponent(m[1]); } catch { objnum = m[1]; }
    objnum = objnum.replace(/--[0-9a-f]{16,}$/i, '').trim();
    if (RIJKS_OBJNUM.test(objnum)) return objnum;
    return { invalid: objnum };
  }
  return null;
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(2); }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const books = client.db('bookstore').collection('books');

  const stats = { met: { scoped: 0, written: 0, unparsed: 0 }, rijksmuseum: { scoped: 0, written: 0, unparsed: 0 } };
  const unparsed = [];

  for (const [provider, urlRe, extract] of [
    ['met', /metmuseum\.org/i, extractMet],
    ['rijksmuseum', /rijksmuseum\.nl/i, extractRijks],
  ]) {
    const query = {
      resource_type: { $exists: true },
      [`source_ids.${provider}`]: { $exists: false },
      $or: [{ commons_url: urlRe }, { source_url: urlRe }],
    };
    const docs = await books.find(query, {
      projection: { _id: 1, id: 1, slug: 1, commons_url: 1, source_url: 1 },
    }).limit(LIMIT || 0).toArray();
    stats[provider].scoped = docs.length;

    const ops = [];
    for (const doc of docs) {
      const id = extract(doc);
      if (!id || typeof id === 'object') {
        stats[provider].unparsed++;
        unparsed.push({ provider, id: doc.id || String(doc._id), slug: doc.slug, url: doc.source_url || doc.commons_url, invalid: id?.invalid });
        continue;
      }
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { [`source_ids.${provider}`]: id } } } });
    }
    if (ops.length && !DRY_RUN) {
      const r = await books.bulkWrite(ops, { ordered: false });
      stats[provider].written = r.modifiedCount;
    } else {
      stats[provider].written = ops.length; // dry-run: would-write
    }
    console.log(`${provider}: ${stats[provider].scoped} scoped, ${stats[provider].written} ${DRY_RUN ? 'would write' : 'written'}, ${stats[provider].unparsed} unparsed`);
  }

  if (unparsed.length) {
    console.log(`\n${unparsed.length} unparsed URL(s):`);
    for (const u of unparsed.slice(0, 15)) console.log(`  [${u.provider}] ${u.slug} — ${u.url}${u.invalid ? ` (extracted "${u.invalid}" failed validation)` : ''}`);
    if (unparsed.length > 15) console.log(`  … and ${unparsed.length - 15} more (see JSON report)`);
  }

  const outPath = `scripts/output/provider-source-ids-backfill-${new Date().toISOString().slice(0, 10)}.json`;
  fs.mkdirSync('scripts/output', { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), dry_run: DRY_RUN, stats, unparsed }, null, 2));
  console.log(`\nFull report → ${outPath}`);

  await client.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
