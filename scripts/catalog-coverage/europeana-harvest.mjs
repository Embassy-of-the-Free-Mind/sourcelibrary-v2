#!/usr/bin/env node
/**
 * Europeana harvester — the "big source" enumerator.
 *
 * Europeana (europeana.eu) aggregates 58M+ digitized items from MDZ (Bavarian
 * State Library), Gallica, Heidelberg, the Austrian National Library, and
 * hundreds of other European institutions — the exact continental early-modern
 * corpus our USTC-gap engine kept missing (their OAI endpoints are dead or
 * absent). We already hold a EUROPEANA_API_KEY.
 *
 * This searches Europeana by subject, keeps TEXT records with a resolvable IIIF
 * manifest, dedupes against holdings, and writes entries in the exact input
 * format consumed by scripts/import/iiif-direct-import.mjs (which then imports
 * book+pages directly to Mongo, no API route — big volumes are fine).
 *
 * MANIFEST RESOLUTION (per provider):
 *   - MDZ / Bavarian State Library: shownBy/guid carries a `bsb\d{7,}` id ->
 *     https://api.digitale-sammlungen.de/iiif/presentation/v2/{bsb}/manifest
 *   Other providers are skipped for now (their manifests aren't uniformly
 *   derivable); MDZ alone is the bulk of the on-mission continental Latin/Greek.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/catalog-coverage/europeana-harvest.mjs \
 *       --query='alchemia OR alchymia OR hermetica OR paracelsus' \
 *       --out=/root/mdz-alchemy.json [--max=500] [--collections=alchemy]
 *
 * Options:
 *   --query=<europeana query>   Required.
 *   --out=<file>                Required. Output JSON (direct-importer format).
 *   --max=N                     Cap harvested entries (default 1000).
 *   --collections=a,b           collections[] to tag imported books with.
 *   --lang=<label>              default language label for imports (default 'Latin').
 *   --min-year=YYYY             only records issued on/after this year (Europeana YEAR facet).
 *   --max-year=YYYY             only records issued on/before this year — use ~1800 to keep
 *                               PRIMARY early-modern sources and exclude 19th-c. secondary studies.
 *   --no-dedupe                 skip the holdings dedupe pass (faster preview).
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

const KEY = process.env.EUROPEANA_API_KEY;
if (!KEY) { console.error('EUROPEANA_API_KEY not set'); process.exit(1); }

const args = process.argv.slice(2);
const arg = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const QUERY = arg('query');
const OUT = arg('out');
const MAX = parseInt(arg('max', '1000'));
const COLLECTIONS = (arg('collections', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const LANG = arg('lang', 'Latin');
const MIN_YEAR = arg('min-year');
const MAX_YEAR = arg('max-year');
const DEDUPE = !args.includes('--no-dedupe');
if (!QUERY || !OUT) { console.error('--query and --out are required'); process.exit(1); }

const clean = s => (s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
const bsbOf = it => (JSON.stringify([it.edmIsShownBy, it.edmIsShownAt, it.guid, it.id]).match(/(bsb\d{7,})/) || [])[1] || null;
const first = a => Array.isArray(a) ? a[0] : a;

async function search(cursor) {
  const p = new URLSearchParams({ wskey: KEY, query: QUERY, rows: '100', profile: 'rich', cursor });
  p.append('qf', 'TYPE:TEXT');
  if (MIN_YEAR || MAX_YEAR) p.append('qf', `YEAR:[${MIN_YEAR || '*'} TO ${MAX_YEAR || '*'}]`);
  const r = await fetch('https://api.europeana.eu/record/v2/search.json?' + p, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('europeana ' + r.status);
  return r.json();
}

async function main() {
  const mc = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await mc.connect();
  const books = mc.db('bookstore').collection('books');

  const out = [];
  const seenBsb = new Set();
  let cursor = '*', scanned = 0, mdz = 0, held = 0, total = null;

  while (cursor && out.length < MAX) {
    let j;
    try { j = await search(cursor); } catch (e) { console.error('search error:', e.message); break; }
    if (total === null) { total = j.totalResults; console.log(`Europeana total for query: ${total}`); }
    for (const it of (j.items || [])) {
      scanned++;
      const bsb = bsbOf(it);
      if (!bsb || seenBsb.has(bsb)) continue;
      seenBsb.add(bsb);
      mdz++;
      const manifest_url = `https://api.digitale-sammlungen.de/iiif/presentation/v2/${bsb}/manifest`;
      const title = first(it.title) || 'Unknown';
      const author = first(it.dcCreator) || first(it.edmAgentLabel) || 'Unknown';
      const year = (String(first(it.year) || '').match(/\d{4}/) || [])[0] || null;
      // holdings dedupe: same manifest, or same bsb id, or close title+author
      if (DEDUPE) {
        const dup = await books.findOne({ $or: [
          { 'image_source.iiif_manifest': manifest_url },
          { 'image_source.source_id': bsb },
          { 'catalog_ids.bsb': bsb },
        ] }, { projection: { _id: 1 } });
        if (dup) { held++; continue; }
      }
      out.push({
        manifest_url, title, author, year, language: LANG,
        collections: COLLECTIONS,
        provider: 'bsb', provider_name: 'Bayerische Staatsbibliothek',
        source_url: `https://www.digitale-sammlungen.de/en/view/${bsb}`, source_id: bsb,
        license: 'CC-BY-NC-4.0', license_url: 'https://creativecommons.org/licenses/by-nc/4.0/',
        contributing_library: 'Bayerische Staatsbibliothek, Munich',
      });
      if (out.length >= MAX) break;
    }
    cursor = j.nextCursor || null;
    if (scanned % 500 < 100) console.log(`  scanned ${scanned} | mdz ${mdz} | already-held ${held} | to-import ${out.length}`);
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`\nDONE: scanned ${scanned} Europeana records | ${mdz} distinct MDZ | ${held} already held | ${out.length} new -> ${OUT}`);
  await mc.close();
}
main().catch(e => { console.error(e); process.exit(1); });
