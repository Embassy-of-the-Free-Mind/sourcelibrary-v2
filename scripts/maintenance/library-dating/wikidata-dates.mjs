#!/usr/bin/env node
/**
 * Fetch the Wikidata dates the lean dating route uses without a model (#6721), into a cache file:
 *   authors — for every `authors.wikidata_id`: P569 birth, P570 death, P1317 floruit, P2031/P2032 work period
 *   works   — for every `books.work_id` that is a QID: P571 inception, P577 publication, P1191 first performance
 * Each value is kept as an interval at Wikidata's own precision (year / decade / century / millennium). Read-only on
 * Mongo; resumes from the cache (a QID already in it is not asked again).
 *
 * PRIOR ART: scripts/audit/author-anchor-validity.mjs (same SPARQL endpoint, VALUES batches, UA) reads instance-of
 * only; scripts/maintenance/backfill-wikidata-portraits-dates.mjs writes P569/P570 to `entities` one entity at a time
 * through wbgetentities, without precision — a date at century precision would read as an exact year. The
 * authors collection's own wikidata_birth_year/death_year (3,269 rows) carry no precision either.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/library-dating/wikidata-dates.mjs \
 *     <all-books.jsonl> <cache.json> [--batch 150]
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';

const [ALL, CACHE] = process.argv.slice(2, 4);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BATCH = +arg('--batch', 150);
if (!ALL || !CACHE) { console.error('usage: wikidata-dates.mjs <all-books.jsonl> <cache.json> [--batch 150]'); process.exit(2); }
const UA = 'SourceLibrary-work-dating/1.0 (https://sourcelibrary.org; team@sourcelibrary.org)';
const QID = /^Q\d+$/;

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : { authors: {}, works: {}, author_qid: {} };

// authors: slug → QID (a merged author points at its survivor; a quarantined one is not used)
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const authors = await c.db(process.env.MONGODB_DB || 'bookstore').collection('authors')
  .find({ wikidata_id: { $regex: '^Q\\d+$' }, quarantined_at: { $exists: false } }, { projection: { _id: 1, wikidata_id: 1, merged_into: 1 } }).toArray();
await c.close();
for (const a of authors) if (!a.merged_into) cache.author_qid[a._id] = a.wikidata_id;
const authorQids = [...new Set(Object.values(cache.author_qid))].filter((q) => !(q in cache.authors));

const workQids = new Set();
for await (const l of readline.createInterface({ input: fs.createReadStream(ALL) })) {
  if (!l) continue; const w = JSON.parse(l).work_id; if (QID.test(w || '') && !(w in cache.works)) workQids.add(w);
}
console.log(`${authors.length} authors with a QID; to fetch: ${authorQids.length} author QIDs, ${workQids.size} work QIDs`);

/** Wikidata time + precision → [lo, hi] years. 9 year, 8 decade, 7 century, 6 millennium; coarser is dropped. */
function interval(time, precision) {
  const m = String(time || '').match(/^([+-]?)(\d+)-/); if (!m) return null;
  const y = (m[1] === '-' ? -1 : 1) * +m[2]; const p = +precision;
  if (p >= 9) return [y, y];
  if (p === 8) { const d = Math.floor(y / 10) * 10; return [d, d + 9]; }
  // a century value is stored as any year inside it ("+1500" or "+1401" both mean the 15th century; "-0400" is the
  // 4th century BCE, 400–301 BCE)
  if (p === 7) { const k = Math.ceil(Math.abs(y) / 100); return y > 0 ? [(k - 1) * 100 + 1, k * 100] : [-k * 100, -k * 100 + 99]; }
  if (p === 6) { const k = Math.ceil(Math.abs(y) / 1000); return y > 0 ? [(k - 1) * 1000 + 1, k * 1000] : [-k * 1000, -k * 1000 + 999]; }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sparql(query) {
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch('https://query.wikidata.org/sparql', { method: 'POST', body: new URLSearchParams({ query, format: 'json' }),
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(90_000) });
      if (r.status === 429 || r.status >= 500) { await sleep(5_000 * (t + 1)); continue; }
      if (!r.ok) throw new Error(`SPARQL ${r.status}`);
      return (await r.json()).results.bindings;
    } catch (e) { if (t === 4) throw e; await sleep(5_000 * (t + 1)); }
  }
  return [];
}

async function fetchProps(qids, props, into) {
  for (let i = 0; i < qids.length; i += BATCH) {
    const chunk = qids.slice(i, i + BATCH);
    const rows = await sparql(`SELECT ?q ?p ?t ?pr WHERE { VALUES ?q { ${chunk.map((q) => `wd:${q}`).join(' ')} }
      VALUES ?p { ${props.map((p) => `p:${p}`).join(' ')} }
      ?q ?p ?st . ?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
      ?ps wikibase:claim ?p ; wikibase:statementValue ?psv . ?st ?psv ?v . ?v wikibase:timeValue ?t ; wikibase:timePrecision ?pr . }`);
    for (const q of chunk) into[q] = {};
    for (const r of rows) {
      const q = r.q.value.split('/').pop(); const p = r.p.value.split('/').pop(); const iv = interval(r.t.value, r.pr.value);
      if (!iv) continue;
      (into[q].raw ||= []).push([p, r.t.value.slice(0, 12), +r.pr.value]);
      // several statements: keep the widest span they cover (e.g. two disputed birth years)
      const cur = into[q][p]; into[q][p] = cur ? [Math.min(cur[0], iv[0]), Math.max(cur[1], iv[1])] : iv;
    }
    fs.writeFileSync(CACHE, JSON.stringify(cache));
    if ((i / BATCH) % 5 === 0) console.log(`  ${i + chunk.length}/${qids.length}`);
    await sleep(1_000);
  }
}
await fetchProps(authorQids, ['P569', 'P570', 'P1317', 'P2031', 'P2032'], cache.authors);
await fetchProps([...workQids], ['P571', 'P577', 'P1191'], cache.works);
fs.writeFileSync(CACHE, JSON.stringify(cache));
const n = (o, p) => Object.values(o).filter((v) => v[p]).length;
console.log(JSON.stringify({ authors: Object.keys(cache.authors).length, birth: n(cache.authors, 'P569'), death: n(cache.authors, 'P570'),
  floruit: n(cache.authors, 'P1317'), works: Object.keys(cache.works).length, P571: n(cache.works, 'P571'), P577: n(cache.works, 'P577'), P1191: n(cache.works, 'P1191') }));
