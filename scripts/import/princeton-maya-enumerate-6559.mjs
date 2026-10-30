#!/usr/bin/env node
/**
 * Enumerate Princeton's DPUL Mesoamerican exhibit (#6559): every record, its
 * catalogue facts, its manifest's own licence and canvas count, and whether we
 * already hold it. Read-only on Mongo; writes a TSV + JSON for building the
 * BOOKS list in maya-mss-6559.mjs.
 *
 * PRIOR ART: scripts/import/maya-sources-survey-6559.md — the 2026-10-15 survey
 * read these endpoints by hand and kept only the top items; it left no table of
 * all 268 records. scripts/import/maya-mss-6559.mjs#loadRecord reads one record +
 * manifest, but only for arks already chosen. scripts/import/check-holdings.ts
 * answers one title/URL at a time, not a 268-record set against the ark fingerprints.
 *
 *   node --env-file=.env.production.local scripts/import/princeton-maya-enumerate-6559.mjs <out-dir>
 *
 * The list endpoint returns hash ids; the ark is the tail of each row's `links.self`,
 * and `catalog/<ark>.json` gives the Solr document.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: princeton-maya-enumerate-6559.mjs <out-dir>'); process.exit(1); }
const DPUL = 'https://dpul.princeton.edu/mesoamerican/catalog';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    } catch (e) {
      if (i === 3) throw e;
    }
    await sleep(3000 * (i + 1));
  }
  throw new Error(`fetch failed: ${url}`);
}

const v = (doc, k) => (doc[`readonly_${k}_tesim`] || []).map((s) => String(s).replace(/<[^>]+>/g, '').trim()).filter(Boolean);
const NKC = 'http://rightsstatements.org/vocab/NKC/1.0/';
// Content language, not the catalogue's "Mayan languages" facet: that facet also
// tags Nahuatl, Zoque and Chinantec items, and misses a Tz'utujil one filed under Spanish.
const MAYAN_TEXT = /yucatec|k'?ich'?e|quich|pokonchi|pokomam|k'?eq'?chi|kekchi|q'eqchi|chorti|tzotzil|sotzil|kaqchikel|cakchiquel|tzutuhil|tzutujil|\bmaya\b|\bmam\b/i;
const isMayan = (language) => MAYAN_TEXT.test(language.replace(/Mayan languages/g, '')) || language.trim() === 'Mayan languages';

const arks = [];
for (let page = 1; page <= 10; page++) {
  const list = await getJson(`${DPUL}.json?q=&search_field=all_fields&per_page=100&page=${page}`);
  for (const row of list.data) arks.push(row.links.self.split('/').pop());
  if (!list.meta.pages.next_page) break;
}
console.log(`${arks.length} records`);

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await client.connect();
const db = client.db('bookstore');
const held = new Map();
for (const b of await db.collection('books').find(
  { $or: [{ 'image_source.provider': 'princeton' }, { 'image_source.iiif_manifest': /figgy\.princeton\.edu/ }, { source_fingerprints: /^princeton:/ }] },
  { projection: { id: 1, 'dublin_core.dc_identifier': 1, source_fingerprints: 1, 'image_source.iiif_manifest': 1 } },
).toArray()) {
  for (const k of [...(b.dublin_core?.dc_identifier || []), ...(b.source_fingerprints || []), b.image_source?.iiif_manifest].filter(Boolean)) {
    held.set(String(k).replace(/^princeton:/, '').replace(/^iiif:/, 'https://').replace(/\?flatten=true$/, ''), b.id);
  }
}
await client.close();

const rows = [];
for (const ark of arks) {
  const doc = (await getJson(`${DPUL}/${ark}.json`)).response.document;
  const manifestUrl = doc.content_metadata_iiif_manifest_field_ssi || '';
  let license = '', canvases = 0, volumes = 0;
  if (manifestUrl) {
    const m = await getJson(manifestUrl);
    license = m.license || '';
    if (m['@type'] === 'sc:Collection') {
      volumes = m.manifests.length;
      for (const mm of m.manifests) {
        const vm = await getJson(mm['@id']);
        if (vm.license !== m.license && !license.includes(vm.license)) license = `${license}|${vm.license}`;
        canvases += vm.sequences?.[0]?.canvases?.length || 0;
        await sleep(300);
      }
    } else {
      canvases = m.sequences?.[0]?.canvases?.length || 0;
    }
  }
  const arkFull = v(doc, 'identifier').find((i) => i.startsWith('ark:/')) || `ark:/88435/${ark}`;
  const language = [...v(doc, 'language'), ...v(doc, 'text-language')].join('; ');
  const heldBy = held.get(arkFull) || held.get(manifestUrl.replace(/\?flatten=true$/, '')) || '';
  rows.push({
    ark, ark_full: arkFull, title: v(doc, 'title')[0] || '', date: v(doc, 'date')[0] || '', sort_date: doc.sort_date_ssi || '',
    language, mayan: isMayan(language), extent: v(doc, 'extent').join('; '), call_number: v(doc, 'call-number').join('; '),
    rights: v(doc, 'edm-rights').join('; '), license, nkc: license === NKC, manifest: manifestUrl, volumes, canvases,
    creator: v(doc, 'creator').join('; '), abstract: v(doc, 'abstract').join(' '),
    relation: v(doc, 'relation').join(' | '), tags: (doc.exhibit_mesoamerican_tags_ssim || []).join('; '),
    held_by: heldBy,
  });
  process.stdout.write(`\r${rows.length}/${arks.length}`);
  await sleep(300);
}
console.log();

const cols = Object.keys(rows[0]);
const clean = (s) => String(s).replace(/[\t\n\r]+/g, ' ');
writeFileSync(join(OUT, 'princeton-maya.tsv'), [cols.join('\t'), ...rows.map((r) => cols.map((c) => clean(r[c])).join('\t'))].join('\n') + '\n');
writeFileSync(join(OUT, 'princeton-maya.json'), JSON.stringify(rows, null, 1));
const mayan = rows.filter((r) => r.mayan);
console.log(JSON.stringify({
  records: rows.length, mayan: mayan.length,
  mayan_nkc: mayan.filter((r) => r.nkc).length, mayan_held: mayan.filter((r) => r.held_by).length,
  mayan_nkc_not_held: mayan.filter((r) => r.nkc && !r.held_by).length,
  licences: Object.fromEntries([...new Set(rows.map((r) => r.license))].map((l) => [l, rows.filter((r) => r.license === l).length])),
}, null, 1));
