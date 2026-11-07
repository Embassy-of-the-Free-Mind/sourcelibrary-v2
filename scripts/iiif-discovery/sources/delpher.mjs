#!/usr/bin/env node
/**
 * Delpher (KB, National Library of the Netherlands) book discovery harvester.
 *
 * PRIOR ART: scripts/iiif-discovery/sources/oai-dc.mjs / nb-norway.mjs — same
 * candidate shape and idempotent upsert. Delpher's own results API is JSON with a
 * `periode` (century) facet, which selects the pre-1900 shelf server-side; the KB
 * OAI endpoint (services.kb.nl/mdo/oai) has no such date set, and leiden.mjs is the
 * Leiden University IIIF adapter, a different library.
 *
 * Harvests `coll=boeken` for the centuries given by --centuries (default
 * 15e–19e eeuw) and keeps only records whose access decision for the OBJECT is
 * PERMIT (UsageRights OutOfCopyrightInEU on the probe). DENIED rows are counted,
 * never written. Images: KB resolver URNs (`resolver.kb.nl/resolve?urn=<bookid>:<page>:image`),
 * no IIIF Presentation manifest — an importer needs a small adapter.
 *
 * Writes `import_candidates` rows ONLY (status 'discovered'), idempotent on
 * (source, source_id). Never touches `books`.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/iiif-discovery/sources/delpher.mjs
 *   … --centuries=17,18 --dry-run --max-records=300
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, upsertCandidates } from '../lib/candidate-store.mjs';
import { parseDateRange } from '../lib/iiif-metadata.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : true];
}));
const DRY_RUN = 'dry-run' in args;
const MAX_RECORDS = parseInt(args['max-records']) || Infinity;
const CENTURIES = String(args.centuries || '15,16,17,18,19').split(',').map(s => s.trim());
const DELAY = parseInt(args.delay) || 1100;
const PER_PAGE = 100;
const API = 'https://www.delpher.nl/nl/api/results';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) delpher-harvest';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Delpher labels languages in Dutch.
const LANG = { Nederlands: 'Dutch', Latijn: 'Latin', Frans: 'French', Duits: 'German', Engels: 'English', Italiaans: 'Italian', Spaans: 'Spanish', Grieks: 'Greek', Hebreeuws: 'Hebrew', Fries: 'Frisian', Portugees: 'Portuguese', Maleis: 'Malay', Javaans: 'Javanese' };

async function page(century, n) {
  const url = `${API}?query=*&coll=boeken&facets%5Bperiode%5D%5B%5D=0%7C${century}e_eeuw%7C&maxperpage=${PER_PAGE}&page=${n}`;
  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(`API ${j.error.code} ${j.error.message}`);
      return j;
    } catch (e) { last = e; console.error(`  ${century}e p${n}: ${e.message}`); await sleep(10000); }
  }
  throw last;
}

// Delpher returns some fields as a string on one record and an array on the next.
const first = v => (Array.isArray(v) ? v[0] : v) ?? null;

function toCandidate(r) {
  const { earliest, latest } = parseDateRange(first(r.date));
  const lang = Array.isArray(r.language) ? r.language[0] : r.language;
  return {
    source: 'delpher',
    source_id: r.bookid,
    manifest_url: null,
    origin_library: r.source || 'Koninklijke Bibliotheek (Delpher)',
    provider_name: 'Delpher (KB)',
    title: first(r.title) || 'Unknown',
    author: first(r.creator) || 'Unknown',
    language: LANG[lang] || lang || 'Unknown',
    date_text: first(r.date),
    date_earliest: earliest,
    date_latest: latest,
    subjects: [r.subject].flat().filter(Boolean),
    source_url: r.identifier || `https://resolver.kb.nl/resolve?urn=${r.bookid}`,
    metadata: {
      bookid: r.bookid,
      ppn_url: r.recordIdentifier || null,
      digitization_project: r.digitizationProject || null,
      rights: r.extradata?.decision?.OBJECT?.advice?.UsageRights || null,
      title_page: r.titlePage || null,
      extent: r.extent || null,
    },
  };
}

await withMongo(async (db) => {
  if (!DRY_RUN) await ensureIndexes(db);
  console.log(`=== Delpher boeken harvest: centuries ${CENTURIES.join(',')}${DRY_RUN ? ' (dry run)' : ''} ===`);
  let seen = 0, inserted = 0, denied = 0;
  const langs = {};
  for (const c of CENTURIES) {
    let total = null;
    for (let n = 1; seen < MAX_RECORDS; n++) {
      const j = await page(c, n);
      if (total == null) { total = j.numberOfRecords; console.log(`${c}e eeuw: ${total.toLocaleString()} records`); }
      const recs = j.records || [];
      if (!recs.length) break;
      const permit = recs.filter(r => r.extradata?.decision?.OBJECT?.outcome === 'PERMIT' && r.bookid);
      denied += recs.length - permit.length;
      const rows = permit.map(toCandidate);
      seen += rows.length;
      for (const r of rows) langs[r.language] = (langs[r.language] || 0) + 1;
      if (!DRY_RUN && rows.length) inserted += (await upsertCandidates(db, rows)).inserted;
      if (n % 20 === 0) console.log(`  ${c}e page ${n}: seen ${seen.toLocaleString()}, new ${inserted.toLocaleString()}`);
      await sleep(DELAY);
      if (n * PER_PAGE >= total) break;
    }
  }
  console.log(`done: ${seen.toLocaleString()} PERMIT records (${denied} DENIED skipped), ${inserted.toLocaleString()} new rows`);
  console.log(`languages: ${Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(' ')}`);
}, { noTimeout: true });
