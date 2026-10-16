#!/usr/bin/env node
/**
 * Fetch the BDRC dates the dating route uses before any model (#6721, Derek 2026-10-15: "catalogue ids … BDRC dates for
 * the instance and the author person record"), into a cache file:
 *   instances — for every book whose BDRC instance is known (catalog_ids.bdrc_instance, or bdr:MW… in its
 *               image_source URL/identifier): the instance's PublishedEvent window (notBefore/notAfter/onYear), its
 *               work (instanceOf) and the persons credited on the instance or the work
 *   works     — each instance's work (WA…): its AuthoredEvent window (when the WORK was written, #6721 work dates)
 *               and its creators with their roles (`roles`: role id → English label, e.g. R0ER0019 → "main author")
 *   persons   — for those persons and every `authors.bdrc_ids` person: PersonBirth / PersonDeath years
 *   book_instance — book_id → instance id (a scan id bdr:W… in the image_source URL resolves to its MW… instance)
 * Read-only on Mongo; resumes from the cache.
 *
 * PRIOR ART: scripts/maintenance/library-dating/wikidata-dates.mjs (same shape, Wikidata); the BDRC importers
 * (git grep -l purl.bdrc.io scripts/import) read manifests and labels, not events. none reads PublishedEvent or
 * PersonBirth/PersonDeath.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/library-dating/bdrc-dates.mjs <cache.json> [--persons ids.txt]
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const CACHE = process.argv[2];
const PERSONS = process.argv.includes('--persons') ? process.argv[process.argv.indexOf('--persons') + 1] : null;
if (!CACHE) { console.error('usage: bdrc-dates.mjs <cache.json>'); process.exit(2); }
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : { instances: {}, works: {}, persons: {}, book_instance: {}, author_person: {} };

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const books = await db.collection('books').find({ pages_count: { $gt: 0 }, $or: [{ 'catalog_ids.bdrc_instance': { $exists: true } }, { 'image_source.provider': 'bdrc' }] },
  { projection: { id: 1, catalog_ids: 1, 'image_source.source_url': 1, 'image_source.identifier': 1 } }).toArray();
for (const b of books) {
  const mw = b.catalog_ids?.bdrc_instance || String(b.image_source?.source_url || '').match(/bdr:(MW\w+)/)?.[1] || String(b.image_source?.identifier || '').match(/^(MW\w+)/)?.[1];
  if (mw) cache.book_instance[String(b.id || b._id)] = mw.replace(/^bdr:/, '');
  // a scan (image instance) id, bdr:W…: its instance is resolved below (instanceReproductionOf)
  else { const w = String(b.image_source?.source_url || '').match(/bdr:(W\w+)/)?.[1]; if (w) (cache.book_scan ||= {})[String(b.id || b._id)] = w; }
}
for (const a of await db.collection('authors').find({ bdrc_ids: { $exists: true, $ne: [] } }, { projection: { bdrc_ids: 1 } }).toArray()) {
  const p = (Array.isArray(a.bdrc_ids) ? a.bdrc_ids : [a.bdrc_ids]).map((x) => String(x).replace(/^bdr:/, '')).find((x) => /^P\w+$/.test(x));
  if (p) cache.author_person[a._id] = p;
}
await c.close();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function graph(id) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(`https://purl.bdrc.io/resource/${id}.jsonld`, { headers: { Accept: 'application/ld+json', 'User-Agent': 'SourceLibrary-work-dating/1.0 (https://sourcelibrary.org; team@sourcelibrary.org)' }, signal: AbortSignal.timeout(30_000) });
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`BDRC ${r.status}`);
      const j = await r.json(); return j['@graph'] || [j];
    } catch (e) { if (t === 3) { console.error(`  ${id}: ${e.message}`); return null; } await sleep(2_000 * (t + 1)); }
  }
  return null;
}
const yr = (v) => { const m = String(v?.['@value'] ?? v ?? '').match(/^(-?\d{1,4})/); return m ? +m[1] : null; };
/** An event node's [from, to]: onYear, else notBefore–notAfter, else the EDTF eventWhen ("1982/1985", "17XX"). */
function eventWindow(n) {
  const on = yr(n.onYear); if (on != null) return [on, on];
  const nb = yr(n.notBefore), na = yr(n.notAfter); if (nb != null || na != null) return [nb ?? na, na ?? nb];
  const w = String(n.eventWhen?.['@value'] || '');
  let m; if ((m = w.match(/^(\d{4})\/(\d{4})$/))) return [+m[1], +m[2]];
  if ((m = w.match(/^(\d{2})XX$/))) return [+m[1] * 100, +m[1] * 100 + 99];
  if ((m = w.match(/^(\d{3})X$/))) return [+m[1] * 10, +m[1] * 10 + 9];
  return null;
}
const types = (n) => [].concat(n['@type'] || []);
const ref = (x) => String(x?.['@id'] || x || '').replace(/^bdr:/, '');
const creatorsOf = (g, id) => {
  const node = g.find((n) => ref(n['@id']) === id); const crs = [].concat(node?.creator || []).map(ref);
  return crs.map((cr) => g.find((n) => ref(n['@id']) === cr)).filter(Boolean).map((n) => ({ person: ref(n.agent), role: ref(n.role) })).filter((x) => /^P/.test(x.person));
};

cache.scans ||= {}; cache.roles ||= {};
let n = 0;
for (const w of [...new Set(Object.values(cache.book_scan || {}))].filter((x) => !(x in cache.scans))) {
  const g = await graph(w); if (!g) continue;
  const node = g.find((x) => ref(x['@id']) === w) || {};
  cache.scans[w] = { instance: ref(node.instanceReproductionOf) || null, work: ref(node.instanceOf) || null };
  if (++n % 50 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); console.log(`  scans ${n}`); }
  await sleep(250);
}
for (const [book, w] of Object.entries(cache.book_scan || {})) if (cache.scans[w]?.instance) cache.book_instance[book] = cache.scans[w].instance;
n = 0;
for (const mw of [...new Set(Object.values(cache.book_instance))].filter((x) => !(x in cache.instances))) {
  const g = await graph(mw); if (!g) continue;
  const node = g.find((x) => ref(x['@id']) === mw) || {};
  const ev = g.find((x) => types(x).includes('PublishedEvent') || types(x).includes('CopyEvent'));
  cache.instances[mw] = { published: ev ? eventWindow(ev) : null, event: ev ? types(ev)[0] : null, work: ref(node.instanceOf) || null, creators: creatorsOf(g, mw) };
  if (++n % 25 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); console.log(`  instances ${n}`); }
  await sleep(250);
}
n = 0;
for (const wa of [...new Set([...Object.values(cache.instances).map((i) => i.work), ...Object.values(cache.scans).map((s) => s.work)].filter(Boolean))].filter((x) => !(x in cache.works) || !('authored' in cache.works[x]))) {
  const g = await graph(wa); if (!g) continue;
  const ev = g.find((x) => types(x).includes('AuthoredEvent'));
  const node = g.find((x) => ref(x['@id']) === wa) || {};
  const label = [].concat(node['skos:prefLabel'] || []).find((l) => l['@language'] === 'bo-x-ewts')?.['@value'] || null;
  cache.works[wa] = { creators: creatorsOf(g, wa), authored: ev ? eventWindow(ev) : null, label };
  if (++n % 50 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); console.log(`  works ${n}`); }
  await sleep(250);
}
const persons = new Set([...Object.values(cache.author_person), ...Object.values(cache.instances).flatMap((i) => i.creators.map((x) => x.person)),
  ...Object.values(cache.works).flatMap((w) => w.creators.map((x) => x.person)),
  // --persons <file>: more BDRC person ids, one a line (the colophon authors tibetan-work-dates.mjs names)
  ...(PERSONS ? fs.readFileSync(PERSONS, 'utf8').split('\n').map((s) => s.trim().replace(/^bdr:/, '')).filter((s) => /^P\w+$/.test(s)) : [])]);
n = 0;
for (const p of [...persons].filter((x) => !(x in cache.persons))) {
  const g = await graph(p); if (!g) continue;
  const birth = g.find((x) => types(x).includes('PersonBirth')); const death = g.find((x) => types(x).includes('PersonDeath'));
  const fl = g.find((x) => types(x).includes('PersonFlourished'));
  const pnode = g.find((x) => ref(x['@id']) === p) || {};
  const names = [].concat(pnode['skos:prefLabel'] || []).filter((l) => /^bo/.test(l['@language'] || '')).map((l) => l['@value']);
  cache.persons[p] = { birth: birth ? eventWindow(birth) : null, death: death ? eventWindow(death) : null, floruit: fl ? eventWindow(fl) : null, names };
  if (++n % 50 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); console.log(`  persons ${n}`); }
  await sleep(250);
}
for (const r of [...new Set(Object.values(cache.works).flatMap((w) => w.creators.map((x) => x.role)))].filter((x) => x && !(x in cache.roles))) {
  const g = await graph(r); if (!g) continue;
  const node = g.find((x) => ref(x['@id']) === r) || g[0] || {};
  cache.roles[r] = [].concat(node['skos:prefLabel'] || []).find((l) => l['@language'] === 'en')?.['@value'] || null;
  await sleep(250);
}
fs.writeFileSync(CACHE, JSON.stringify(cache));
const I = Object.values(cache.instances); const P = Object.values(cache.persons);
console.log(JSON.stringify({ books: Object.keys(cache.book_instance).length, instances: I.length, with_published: I.filter((i) => i.published).length,
  works: Object.keys(cache.works).length, works_authored: Object.values(cache.works).filter((w) => w.authored).length, persons: P.length, with_birth_death: P.filter((p) => p.birth && p.death).length, author_person: Object.keys(cache.author_person).length }));
