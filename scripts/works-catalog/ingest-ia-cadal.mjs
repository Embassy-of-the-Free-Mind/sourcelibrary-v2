#!/usr/bin/env node
/**
 * Attach IA-CADAL facsimile scans to Chinese works (#2453, feeds #2447).
 *
 * IA's `collection:universallibrary` holds 78K+ CADAL scans (identifiers
 * `NNNNNNNN.cn`, sponsor "China-America Digital Academic Library"). Items are
 * VOLUME-level: titles like 毛詩注疏·卷四~卷五 — base title before '·',
 * juan coverage after. We group by variant-normalized base title, match to
 * existing chinese works, and write one work_sources row per volume with
 * coverage preserved (never collapse volumes into each other — the work/
 * edition/item invariant).
 *
 * Manifest URL is a pure function of the identifier (iiif.archive.org), so
 * no per-item fetches are needed.
 *
 * Idempotent. ~78K items via IA's cursor scrape API (fast, ~8 calls).
 *   node scripts/works-catalog/ingest-ia-cadal.mjs
 */
import { pgClient, normalizeCjk, fetchRetry, sleep, upsertSources } from './lib.mjs';

// 1. full sweep of the collection via the scrape API (cursor-based)
const items = [];
let cursor = null;
for (;;) {
  const url = `https://archive.org/services/search/v1/scrape?q=${encodeURIComponent('collection:universallibrary')}&fields=identifier,title,language&count=10000${cursor ? `&cursor=${cursor}` : ''}`;
  const j = await (await fetchRetry(url, { headers: { 'User-Agent': 'SourceLibrary-WorksCatalog/1.0 (derek@sourcelibrary.org)' } })).json();
  items.push(...(j.items || []));
  process.stderr.write(`scraped ${items.length}/${j.total}\n`);
  if (!j.cursor) break;
  cursor = j.cursor;
  await sleep(1000);
}
// CADAL items are the .cn identifiers; the collection also has Indic/English material
const cn = items.filter(i => /\.cn$/.test(i.identifier) && i.title);
console.log(`IA universallibrary: ${items.length} items, ${cn.length} CADAL .cn items`);

// 2. group by base title (before '·'), keep coverage suffix per volume
const groups = new Map(); // normalized base -> [{identifier, title, coverage}]
for (const it of cn) {
  const title = String(it.title);
  const dot = title.indexOf('·');
  const base = (dot > 0 ? title.slice(0, dot) : title).trim();
  const coverage = dot > 0 ? title.slice(dot + 1).trim() : null;
  const norm = normalizeCjk(base);
  if (!norm) continue;
  if (!groups.has(norm)) groups.set(norm, []);
  groups.get(norm).push({ identifier: it.identifier, title, coverage });
}
console.log(`${groups.size} distinct base titles`);

// 3. match to chinese works by normalized title
const client = pgClient();
await client.connect();
const works = await client.query(`select id, title_normalized from works where tradition = 'chinese'`);
const byNorm = new Map();
for (const w of works.rows) {
  if (!byNorm.has(w.title_normalized)) byNorm.set(w.title_normalized, w.id);
}

const sources = [];
let matchedWorks = 0, matchedVols = 0;
for (const [norm, vols] of groups) {
  const workId = byNorm.get(norm);
  if (!workId) continue;
  matchedWorks++;
  matchedVols += vols.length;
  for (const v of vols) {
    sources.push({
      work_id: workId,
      source: 'ia-cadal',
      source_id: v.identifier,
      kind: 'scan',
      url: `https://iiif.archive.org/iiif/${v.identifier}/manifest.json`,
      iiif: true,
      coverage: v.coverage,
      extra: { ia_title: v.title },
    });
  }
}
console.log(`Matched ${matchedWorks} works / ${matchedVols} volumes (${groups.size - matchedWorks} base titles unmatched — editions of works outside the catalog)`);

const n = await upsertSources(client, sources);
const stats = (await client.query(`
  select count(distinct work_id) works, count(*) vols from work_sources where source = 'ia-cadal'`)).rows[0];
await client.end();
console.log(`Upserted ${n} sources. ia-cadal now: ${stats.works} works, ${stats.vols} volume rows`);
