#!/usr/bin/env node
/**
 * Nasjonalbiblioteket (National Library of Norway) discovery harvester.
 *
 * PRIOR ART: scripts/iiif-discovery/sources/oai-dc.mjs and kramerius.mjs —
 * same candidate shape and upsert; NB's catalogue is a JSON (HAL) search API,
 * not OAI or Solr, and every digital item links its own IIIF manifest, so the
 * candidate gets a real manifest_url (the IIIF pipeline can import it as is).
 *
 * Harvests books (`mediatype:bøker`) that are DIGITAL and PUBLIC DOMAIN by NB's own
 * flag (`filter=digital:Ja`, then `accessInfo.isPublicDomain === true` per item),
 * dated 1400–(--before - 1). The API stops paging deep into one query, so the
 * year range is bisected until each window holds < 4,900 items (the API answers HTTP 400 past offset 5,000).
 *
 * Writes `import_candidates` rows ONLY (status 'discovered'), idempotent on
 * (source, source_id). Never touches `books`.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/iiif-discovery/sources/nb-norway.mjs
 *   … --before=1900 --dry-run --max-records=500
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, upsertCandidates } from '../lib/candidate-store.mjs';
import { parseDateRange, normalizeLanguage } from '../lib/iiif-metadata.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : true];
}));
const DRY_RUN = 'dry-run' in args;
const MAX_RECORDS = parseInt(args['max-records']) || Infinity;
const BEFORE = parseInt(args.before) || 1900;
const DELAY = parseInt(args.delay) || 1100;
const SIZE = 100;
// Measured 2026-10-24: page*size past 5,000 answers HTTP 400.
const WINDOW_MAX = 4900;
const API = 'https://api.nb.no/catalog/v1/items';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) nb-catalogue-harvest';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search(from, to, page, size = SIZE) {
  const p = new URLSearchParams({ q: '*', page: String(page), size: String(size) });
  for (const f of ['mediatype:bøker', `year:[${from} TO ${to}]`, 'digital:Ja']) p.append('filter', f);
  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${API}?${p}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { last = e; console.error(`  ${from}-${to} p${page}: ${e.message}`); await sleep(10000); }
  }
  throw last;
}

// Bisect [from, to] into windows each small enough to page through.
async function windows(from, to) {
  const j = await search(from, to, 0, 1);
  await sleep(DELAY);
  const n = j.page?.totalElements || 0;
  if (n <= WINDOW_MAX || from === to) return n ? [{ from, to, n }] : [];
  const mid = Math.floor((from + to) / 2);
  return [...await windows(from, mid), ...await windows(mid + 1, to)];
}

function toCandidate(it) {
  const m = it.metadata || {};
  const issued = m.originInfo?.issued || null;
  const { earliest, latest } = parseDateRange(issued ? String(issued).slice(0, 4) : null);
  return {
    source: 'nb_norway',
    source_id: it.id,
    manifest_url: it._links?.presentation?.href?.replace(':443/', '/') || null,
    origin_library: 'Nasjonalbiblioteket (Norway)',
    provider_name: 'Nasjonalbiblioteket (Norway)',
    title: m.title || m.titleInfos?.[0]?.title || 'Unknown',
    author: m.creators?.[0] || 'Unknown',
    language: normalizeLanguage(m.languages?.[0]?.code || ''),
    date_text: issued,
    date_earliest: earliest,
    date_latest: latest,
    page_count: m.pageCount || null,
    subjects: [...(m.subject?.topics || []), ...(m.subject?.genres || [])],
    source_url: m.identifiers?.urn ? `https://urn.nb.no/${m.identifiers.urn}` : `https://www.nb.no/items/${it.id}`,
    metadata: {
      urn: m.identifiers?.urn || null,
      oai_id: m.identifiers?.oaiId || null,
      rights: it.accessInfo?.license || null,
      languages: (m.languages || []).map(l => l.code),
      publisher: m.originInfo?.publisher || null,
    },
  };
}

await withMongo(async (db) => {
  if (!DRY_RUN) await ensureIndexes(db);
  console.log(`=== NB Norway harvest: digital PD books 1400–${BEFORE - 1}${DRY_RUN ? ' (dry run)' : ''} ===`);
  const wins = await windows(1400, BEFORE - 1);
  console.log(`windows: ${wins.map(w => `${w.from}-${w.to}:${w.n}`).join(' ')}`);
  let seen = 0, inserted = 0, notPd = 0;
  const langs = {};
  for (const w of wins) {
    for (let page = 0; page * SIZE < w.n && seen < MAX_RECORDS; page++) {
      const j = await search(w.from, w.to, page);
      const items = j._embedded?.items || [];
      if (!items.length) break;
      const pd = items.filter(it => it.accessInfo?.isPublicDomain === true);
      notPd += items.length - pd.length;
      const records = pd.map(toCandidate);
      seen += records.length;
      for (const r of records) langs[r.language] = (langs[r.language] || 0) + 1;
      if (!DRY_RUN && records.length) inserted += (await upsertCandidates(db, records)).inserted;
      if (page % 20 === 0) console.log(`  ${w.from}-${w.to} page ${page}: seen ${seen.toLocaleString()}, new ${inserted.toLocaleString()}`);
      await sleep(DELAY);
    }
  }
  console.log(`done: ${seen.toLocaleString()} PD records (${notPd} digital but not PD skipped), ${inserted.toLocaleString()} new rows`);
  console.log(`languages: ${Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(' ')}`);
}, { noTimeout: true });
