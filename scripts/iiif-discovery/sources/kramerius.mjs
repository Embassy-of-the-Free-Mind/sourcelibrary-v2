#!/usr/bin/env node
/**
 * Kramerius discovery harvester — Czech digital libraries (NKP Prague, MZK Brno).
 *
 * PRIOR ART: scripts/iiif-discovery/sources/erara.mjs (OAI loop) and
 * oai-dc.mjs — Kramerius has no OAI-DC here; it exposes its Solr index, which
 * pages 1,000 rows a request and filters by date and licence server-side, so a
 * whole public pre-1900 shelf is ~15 requests. Nothing in sources/ speaks Solr.
 *
 * Writes `import_candidates` rows ONLY (status 'discovered'), idempotent on
 * (source, source_id) via upsertCandidates(). Never touches `books`.
 * Only PUBLIC records are harvested (NKP `dostupnost:public`, MZK
 * `licenses:public`) — the rest are in-copyright or on-site only.
 *
 * Images: Kramerius 5 (NKP) has no IIIF Presentation manifest; pages come from
 * /search/api/v5.0/item/<pid>/children and each page's /streams/IMG_FULL. An
 * importer needs a small adapter — recorded in library-harvest-registry.md.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/iiif-discovery/sources/kramerius.mjs --site=nkp
 *   … --site=mzk
 *   … --before=1900     (default) only records dated 1..1899
 *   … --dry-run --max-records=2000
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, upsertCandidates } from '../lib/candidate-store.mjs';
import { normalizeLanguage } from '../lib/iiif-metadata.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : true];
}));
const DRY_RUN = 'dry-run' in args;
const MAX_RECORDS = parseInt(args['max-records']) || Infinity;
const BEFORE = parseInt(args.before) || 1900;
const DELAY = parseInt(args.delay) || 1100;
const ROWS = 1000;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library; Kramerius harvest)';

const SITES = {
  nkp: {
    source: 'kramerius_nkp',
    origin: 'Národní knihovna České republiky (Kramerius)',
    search: 'https://kramerius5.nkp.cz/search/api/v5.0/search',
    // datum_begin:0 is UNDATED, not year 0 — start the range at 1.
    q: () => `fedora.model:monograph AND dostupnost:public AND datum_begin:[1 TO ${BEFORE - 1}]`,
    fl: 'PID,dc.title,dc.creator,datum_begin,datum_str,language,keywords,dostupnost',
    map: d => ({
      id: d.PID, title: d['dc.title'], author: d['dc.creator']?.[0], year: d.datum_begin, date_text: d.datum_str,
      lang: d.language?.[0], subjects: d.keywords || [], rights: d.dostupnost,
      url: `https://kramerius5.nkp.cz/uuid/${d.PID}`,
    }),
  },
  mzk: {
    source: 'kramerius_mzk',
    origin: 'Moravská zemská knihovna v Brně (Kramerius)',
    search: 'https://api.kramerius.mzk.cz/search/api/client/v7.0/search',
    q: () => '*:*',
    // The K7 client API answers cursorMark with HTTP 500; plain start= paging
    // is fine at this size (~15 pages).
    paging: 'start',
    fq: () => `model:monograph AND licenses.facet:public AND date.min:[* TO ${BEFORE - 1}-12-31T23:59:59Z]`,
    fl: 'pid,title.search,authors,date_range_start.year,date.str,languages.facet,keywords.facet,genres.facet,licenses.facet',
    map: d => ({
      id: d.pid, title: d['title.search'], author: d.authors?.[0], year: d['date_range_start.year'], date_text: d['date.str'],
      lang: d['languages.facet']?.[0], subjects: [...(d['keywords.facet'] || []), ...(d['genres.facet'] || [])], rights: d['licenses.facet']?.[0],
      url: `https://www.digitalniknihovna.cz/mzk/uuid/${d.pid}`,
    }),
  },
};
const site = SITES[args.site];
if (!site) { console.error(`--site=<${Object.keys(SITES).join('|')}> required`); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(cursor, start) {
  const p = new URLSearchParams({ q: site.q(), rows: String(ROWS), wt: 'json', fl: site.fl });
  if (site.paging === 'start') { p.set('start', String(start)); p.set('sort', 'pid asc'); } else { p.set('sort', 'PID asc'); p.set('cursorMark', cursor); }
  if (site.fq) p.set('fq', site.fq());
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${site.search}?${p}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      // MZK drops ~1 in 5 TLS handshakes (SSL_ERROR_SYSCALL); a retry clears it.
      last = e; console.error(`  attempt ${attempt}: ${e.message}`); await sleep(5000 * attempt);
    }
  }
  throw last;
}

await withMongo(async (db) => {
  if (!DRY_RUN) await ensureIndexes(db);
  let cursor = '*', seen = 0, inserted = 0, total = null;
  const langs = {};
  console.log(`=== Kramerius harvest: ${site.source} (before ${BEFORE})${DRY_RUN ? ' (dry run)' : ''} ===`);
  while (seen < MAX_RECORDS) {
    const j = await page(cursor, seen);
    if (total == null) { total = j.response.numFound; console.log(`numFound ${total.toLocaleString()}`); }
    const docs = j.response.docs || [];
    const records = docs.map(site.map).filter(r => r.id && r.title).map(r => ({
      source: site.source,
      source_id: r.id,
      manifest_url: null,
      origin_library: site.origin,
      provider_name: site.origin,
      title: String(r.title).replace(/&quot;/g, '"'),
      author: r.author || 'Unknown',
      language: normalizeLanguage(r.lang || ''),
      date_text: r.date_text || (r.year ? String(r.year) : null),
      date_earliest: r.year || null,
      date_latest: r.year || null,
      subjects: r.subjects,
      source_url: r.url,
      metadata: { pid: r.id, rights: r.rights, kramerius: site.search.replace(/\/search.*$/, '') },
    }));
    seen += records.length;
    for (const r of records) langs[r.language] = (langs[r.language] || 0) + 1;
    if (!DRY_RUN && records.length) inserted += (await upsertCandidates(db, records)).inserted;
    console.log(`  ${seen.toLocaleString()}/${total.toLocaleString()} seen, ${inserted.toLocaleString()} new`);
    if (docs.length === 0 || seen >= total) break;
    if (site.paging !== 'start' && (!j.nextCursorMark || j.nextCursorMark === cursor)) break;
    cursor = j.nextCursorMark;
    await sleep(DELAY);
  }
  console.log(`done: ${seen.toLocaleString()} records, ${inserted.toLocaleString()} new rows`);
  console.log(`languages: ${Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(' ')}`);
}, { noTimeout: true });
