#!/usr/bin/env node
/**
 * SLUB (Dresden) METS importer.
 *
 * SLUB candidates were harvested via OAI-PMH and carry only `oai_id` / `urn` /
 * `viewer_url` — no IIIF manifest (SLUB's viewer is a SPA with no derivable
 * manifest URL). But the OAI METS record lists every page image directly
 * (USE="ORIGINAL" → full-res .tif.original.jpg). This fetches the METS, builds a
 * minimal IIIF v2 manifest from those image URLs, and imports via the normal
 * /api/import/iiif path (so the warehouse-aware checkDuplicate dedup + pipeline
 * all apply). Recovers the ~739 SLUB mission-core books that had no manifest_url.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/slub-mets-import.mjs --dry-run
 *   node scripts/import/slub-mets-import.mjs --limit=50
 *
 * Flags: --limit N | --delay MS (default 1500) | --min-pages N (default 5) | --dry-run
 */
import { MongoClient } from 'mongodb';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--'))
  .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const LIMIT = parseInt(args.limit) || 0;
const DELAY = parseInt(args.delay) || 1500;
const MIN_PAGES = parseInt(args['min-pages']) || 5;
const DRY_RUN = 'dry-run' in args;

const API_URL = process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';
const AUTH = process.env.CRON_SECRET;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)';
if (!AUTH) { console.error('CRON_SECRET not set'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const col = db.collection('import_candidates');

// Fetch OAI METS and extract ordered full-res page image URLs.
async function getMetsImages(oaiId) {
  const url = `https://digital.slub-dresden.de/oai?verb=GetRecord&metadataPrefix=mets&identifier=${encodeURIComponent(oaiId)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40000) });
  if (!res.ok) throw new Error(`METS fetch ${res.status}`);
  const xml = await res.text();
  // Prefer ORIGINAL (full-res) jpegs; fall back to medium if absent.
  const grab = (suffix) => {
    const re = new RegExp(`xlink:href="(https://[^"]+?(\\d+)\\.tif\\.${suffix}\\.jpg)"`, 'gi');
    const seen = new Map();
    let m; while ((m = re.exec(xml))) seen.set(parseInt(m[2], 10), m[1]);
    return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
  };
  let imgs = grab('original');
  if (imgs.length === 0) imgs = grab('medium');
  return imgs;
}

function buildManifest(viewerUrl, label, imgs) {
  return {
    '@context': 'http://iiif.io/api/presentation/2/context.json',
    '@id': viewerUrl,
    '@type': 'sc:Manifest',
    label,
    sequences: [{
      '@type': 'sc:Sequence',
      canvases: imgs.map((u, i) => ({
        '@id': `${viewerUrl}/canvas/${i + 1}`,
        '@type': 'sc:Canvas',
        label: `${i + 1}`,
        images: [{
          '@type': 'oa:Annotation', motivation: 'sc:painting',
          resource: { '@id': u, '@type': 'dctypes:Image', format: 'image/jpeg' },
          on: `${viewerUrl}/canvas/${i + 1}`,
        }],
      })),
    }],
  };
}

const filter = { source: 'slub', mission_tier: 'core', status: 'discovered', oai_id: { $exists: true, $ne: null } };
let cursor = col.find(filter);
if (LIMIT) cursor = cursor.limit(LIMIT);
const cands = await cursor.toArray();
console.log(`SLUB METS import: ${cands.length} candidates${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

let imported = 0, skipped = 0, failed = 0;
for (const d of cands) {
  const viewerUrl = (d.viewer_url || `https://digital.slub-dresden.de/${d.oai_id}`).replace(/^http:/, 'https:');
  const title = d.title || 'Unknown';
  const author = d.author || 'Unknown';
  const upd = (status, extra = {}) => col.updateOne({ _id: d._id },
    { $set: { status, ...extra, ...(status === 'imported' ? { imported_at: new Date() } : {}) } }).catch(() => {});
  try {
    const imgs = await getMetsImages(d.oai_id);
    if (imgs.length < MIN_PAGES) { await upd('skipped', { skip_reason: `Too few pages in METS: ${imgs.length}` }); skipped++; continue; }
    if (DRY_RUN) { console.log(`[DRY] ${title.slice(0, 60)} — ${imgs.length} pages`); imported++; await sleep(200); continue; }

    const manifest = buildManifest(viewerUrl, title, imgs);
    const res = await fetch(`${API_URL}/api/import/iiif`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTH}` },
      body: JSON.stringify({
        manifest_url: viewerUrl, manifest_data: manifest,
        title, author, language: d.language || undefined,
        published: d.date_text || (d.date_earliest ? String(d.date_earliest) : 'Unknown'),
        provider: 'slub', contributing_library: 'SLUB Dresden',
      }),
      signal: AbortSignal.timeout(90000),
    });
    const result = await res.json();
    if (res.ok && result.success) { await upd('imported', { book_id: result.bookId }); imported++; console.log(`[${imported}] ✓ ${title.slice(0, 55)} — ${result.pagesCreated}p`); }
    else if (res.status === 409) { await upd('skipped', { skip_reason: result.error, book_id: result.existingId }); skipped++; }
    else throw new Error(result.error || `import ${res.status}`);
  } catch (err) {
    await upd('failed', { skip_reason: err.message }); failed++;
    console.error(`[FAIL] ${title.slice(0, 50)}: ${err.message}`);
  }
  await sleep(DELAY);
  if ((imported + skipped + failed) % 50 === 0) console.log(`  ... ${imported} imported, ${skipped} skipped, ${failed} failed`);
}
console.log(`\nDone: ${imported} imported, ${skipped} skipped, ${failed} failed`);
await client.close();
process.exit(0);
