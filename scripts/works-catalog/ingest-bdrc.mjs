#!/usr/bin/env node
/**
 * Ingest BDRC/BUDA (Tibetan & Himalayan Buddhist canon) into the works
 * catalog (#2453).
 *
 * BDRC has no public SPARQL or bulk dump (endpoint answers "disabled for that
 * server"); the only complete route (verified 2026-06-06) is:
 *   1. sitemap enumeration -> ~48,500 bdr:MW* Instance IDs (the rich
 *      bibliographic records; WA* abstract Works are not enumerable directly)
 *   2. per-resource JSON-LD from purl.bdrc.io (CC0) — ~10s/record server-side
 *      latency, so the harvest is disk-cached, resumable, and parallel.
 *   3. load pass groups Instances by their bdo:instanceOf WA Work — one works
 *      row per WA (work-level), one work_sources row per MW (edition-level).
 *
 * Usage (Hetzner):
 *   node scripts/works-catalog/ingest-bdrc.mjs --harvest   # hours; resumable; run under nohup/tmux
 *   node scripts/works-catalog/ingest-bdrc.mjs --load      # parse cache -> Supabase
 *
 * Politeness: BDRC is a small nonprofit server. Concurrency capped at 12,
 * back-off on 5xx, and the cache means we never re-fetch.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { gunzipSync } from 'zlib';
import { pgClient, sleep, upsertWorks, upsertSources } from './lib.mjs';

const CACHE = process.env.BDRC_CACHE_DIR || '/root/works-catalog-cache/bdrc';
const CONCURRENCY = 12;
const UA = { 'User-Agent': 'SourceLibrary-WorksCatalog/1.0 (derek@sourcelibrary.org)' };

async function enumerateIds() {
  const ids = new Set();
  for (const n of ['00001', '00002', '00003', '00004']) {
    const res = await fetch(`https://library.bdrc.io/scripts/sitemap/sitemap-${n}.xml.gz`, { headers: UA });
    const xml = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
    for (const m of xml.matchAll(/show\/bdr:(MW[0-9A-Za-z_-]+)/g)) ids.add(m[1]);
  }
  return [...ids];
}

async function harvest() {
  mkdirSync(CACHE, { recursive: true });
  const ids = await enumerateIds();
  const todo = ids.filter(id => !existsSync(`${CACHE}/${id}.jsonld`));
  console.log(`BDRC: ${ids.length} MW ids, ${todo.length} to fetch (cache: ${CACHE})`);
  let done = 0, errors = 0;
  async function worker(queue) {
    for (;;) {
      const id = queue.pop();
      if (!id) return;
      try {
        const res = await fetch(`https://purl.bdrc.io/resource/${id}.jsonld`, { headers: UA });
        if (res.status >= 500) { errors++; await sleep(15000); queue.push(id); continue; }
        if (!res.ok) { errors++; writeFileSync(`${CACHE}/${id}.error`, String(res.status)); continue; }
        const body = await res.text();
        JSON.parse(body); // truncation guard
        writeFileSync(`${CACHE}/${id}.jsonld`, body);
      } catch { errors++; await sleep(5000); }
      if (++done % 200 === 0) console.log(`${done}/${todo.length} fetched (${errors} errors)`);
    }
  }
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  console.log(`Harvest complete: ${done} fetched, ${errors} errors`);
}

// --- JSON-LD helpers -------------------------------------------------------
const label = v => {
  // prefLabel/altLabel values: object or array of {@value,@language}
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  const by = lang => arr.find(x => x['@language'] === lang)?.['@value'];
  return {
    ewts: by('bo-x-ewts') || null,
    bo: by('bo') || null,
    en: by('en') || by('en-x-mixed') || null,
    zh: by('zh-Hans') || by('zh-Hant') || null,
    any: arr[0]?.['@value'] || (typeof v === 'string' ? v : null),
  };
};
const refs = v => (Array.isArray(v) ? v : v ? [v] : []).map(x => (typeof x === 'string' ? x : x['@id'])).filter(Boolean);

function parseRecord(id) {
  let doc;
  try { doc = JSON.parse(readFileSync(`${CACHE}/${id}.jsonld`, 'utf8')); } catch { return null; }
  const graph = doc['@graph'] || [doc];
  const node = graph.find(n => (n['@id'] || '').endsWith(`bdr:${id}`) || (n['@id'] || '').endsWith(`/${id}`));
  if (!node) return null;
  const pref = label(node['skos:prefLabel'] ?? node.prefLabel);
  const alts = label(node['skos:altLabel'] ?? node.altLabel);
  // creator: reified AgentAsCreator nodes -> agent P-id
  const creatorNodes = refs(node['creator'] ?? node['bdo:creator'])
    .map(cid => graph.find(n => n['@id'] === cid)).filter(Boolean);
  const agents = creatorNodes.flatMap(c => refs(c['agent'] ?? c['bdo:agent']));
  const wa = refs(node['instanceOf'] ?? node['bdo:instanceOf'])[0] || null;
  const event = refs(node['instanceEvent'] ?? node['bdo:instanceEvent'])
    .map(eid => graph.find(n => n['@id'] === eid)).filter(Boolean)[0];
  const when = event?.['eventWhen']?.['@value'] || event?.['eventWhen'] || null;
  return {
    mw: id,
    wa: wa?.replace(/^bdr:/, '') || null,
    title: pref.bo || pref.ewts || pref.any,
    title_bo: pref.bo || alts.bo || null,
    ewts: pref.ewts || alts.ewts || null,
    en: pref.en || alts.en || null,
    agents: agents.map(a => a.replace(/^bdr:/, '')),
    when: typeof when === 'string' ? when : null,
    script: refs(node['script'] ?? node['bdo:script'])[0]?.replace(/^bdr:Script/, '') || null,
  };
}

async function load() {
  const files = readdirSync(CACHE).filter(f => f.endsWith('.jsonld'));
  console.log(`Parsing ${files.length} cached records`);
  const byWa = new Map(); // WA id (or MW fallback) -> { rec, instances: [] }
  let parsed = 0;
  for (const f of files) {
    const rec = parseRecord(f.replace(/\.jsonld$/, ''));
    if (!rec || !rec.title) continue;
    parsed++;
    const key = rec.wa || rec.mw;
    if (!byWa.has(key)) byWa.set(key, { rec, instances: [] });
    byWa.get(key).instances.push(rec);
  }
  console.log(`${parsed} parsed -> ${byWa.size} works (WA-clustered)`);

  const works = [];
  const sources = [];
  for (const [key, { rec, instances }] of byWa) {
    // representative record: prefer one with an English title
    const best = instances.find(i => i.en) || rec;
    const year = parseInt((best.when || '').slice(0, 4), 10);
    works.push({
      id: `bdrc:${key}`,
      tradition: 'tibetan',
      original_language: 'bod',
      title: best.title_bo || best.title,
      title_normalized: (best.title_bo || best.title).trim(),
      title_romanized: best.ewts,
      title_english: best.en,
      author: null, // P-ids resolved in a later pass; stored in authority_ids
      century: Number.isFinite(year) ? Math.floor(year / 100) + 1 : null,
      authority_ids: {
        bdrc_work: rec.wa,
        bdrc_instances: instances.map(i => i.mw).slice(0, 50),
        bdrc_agents: [...new Set(instances.flatMap(i => i.agents))].slice(0, 10),
      },
      corpus_tags: ['bdrc'],
      source_catalog: 'bdrc',
      extra: { script: best.script, published: best.when },
    });
    for (const i of instances) {
      sources.push({
        work_id: `bdrc:${key}`,
        source: 'bdrc',
        source_id: i.mw,
        kind: 'scan', // BUDA viewer record; IIIF manifests hang off the linked image instances
        url: `https://library.bdrc.io/show/bdr:${i.mw}`,
        iiif: true,
        extra: { ewts: i.ewts },
      });
    }
  }
  const client = pgClient();
  await client.connect();
  const nW = await upsertWorks(client, works);
  const nS = await upsertSources(client, sources);
  const count = (await client.query(`select count(*) n from works where source_catalog = 'bdrc'`)).rows[0].n;
  await client.end();
  console.log(`Upserted ${nW} works, ${nS} sources. works(source_catalog=bdrc) = ${count}`);
}

const mode = process.argv[2];
if (mode === '--harvest') await harvest();
else if (mode === '--load') await load();
else { console.error('Usage: ingest-bdrc.mjs --harvest | --load'); process.exit(1); }
