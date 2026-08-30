#!/usr/bin/env node
/**
 * Wellcome Collection — Sanskrit wave 1 (issue #4311, Workstream 3).
 * Step 1+2 of the import loop: ENUMERATE from the source, then DEDUPE
 * against our catalog. Writes a candidate file for human subject-filtering.
 * Imports nothing.
 *
 * Source doc: .claude/docs/sanskrit-sources.md (Wellcome row, verified 2026-08-28).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/import/wellcome-sanskrit-enumerate.mjs
 *   → scripts/import/wellcome-sanskrit-candidates.json
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const API = 'https://api.wellcomecollection.org/catalogue/v2/works';
const OUT = new URL('./wellcome-sanskrit-candidates.json', import.meta.url).pathname;

// ---- 1. ENUMERATE (the repository IS the list) ----------------------------
const works = [];
let page = 1;
for (;;) {
  const url = `${API}?languages=san&items.locations.locationType=iiif-presentation`
    + `&include=items,subjects,production,languages,notes`
    + `&pageSize=100&page=${page}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wellcome API ${res.status} on page ${page}`);
  const data = await res.json();
  works.push(...(data.results || []));
  process.stdout.write(`  enumerated ${works.length}/${data.totalResults}\r`);
  if (!data.nextPage) break;
  page++;
  await new Promise(r => setTimeout(r, 300)); // be polite
}
console.log(`\nenumerated: ${works.length} digitized Sanskrit works`);

// ---- 2. DEDUPE (manifestation level: exact fingerprint + identifier) ------
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const ids = works.map(w => w.id);
// Dedup must see HIDDEN books too — the import backlog is hidden and that is
// exactly where duplicates accumulate (PR #2290).
const held = await db.collection('books').find(
  { $or: [
    { 'image_source.identifier': { $in: ids }, 'image_source.provider': 'wellcome' },
    { source_fingerprint: { $in: ids.map(id => `wellcome:${id}`) } },
  ] },
  { projection: { id: 1, title: 1, visible: 1, 'image_source.identifier': 1, source_fingerprint: 1 } },
).toArray();
const heldIds = new Set(held.flatMap(b => [
  b.image_source?.identifier,
  (b.source_fingerprint || '').replace(/^wellcome:/, ''),
].filter(Boolean)));

// Title-level soft check (work-level dedup is not automatic — issue #2318),
// so a human can eyeball possible alternate scans of a work we already hold.
const norm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sanskritHeld = await db.collection('books').find(
  { $or: [{ language: 'Sanskrit' }, { original_language: 'Sanskrit' }] },
  { projection: { title: 1 } },
).toArray();
const heldTitleKeys = new Set(sanskritHeld.map(b => norm(b.title).split(' ').slice(0, 4).join(' ')).filter(Boolean));

const candidates = works.map(w => {
  const manifest = w.items?.flatMap(i => i.locations || [])
    .find(l => l.locationType?.id === 'iiif-presentation');
  const license = w.items?.flatMap(i => i.locations || [])
    .map(l => l.license?.id).find(Boolean) || null;
  const titleKey = norm(w.title).split(' ').slice(0, 4).join(' ');
  return {
    source: 'wellcome',
    work_id: w.id,
    title: w.title,
    author: w.contributors?.[0]?.agent?.label || null,
    date: w.production?.flatMap(p => p.dates || []).map(d => d.label)[0] || null,
    subjects: (w.subjects || []).map(s => s.label),
    manifest_url: manifest?.url || null,
    license,
    record_url: `https://wellcomecollection.org/works/${w.id}`,
    status: heldIds.has(w.id) ? 'HELD'
      : (titleKey && heldTitleKeys.has(titleKey)) ? 'TITLE_CLASH'
      : 'NEW',
  };
});

const by = s => candidates.filter(c => c.status === s).length;
console.log(`HELD: ${by('HELD')}  TITLE_CLASH: ${by('TITLE_CLASH')}  NEW: ${by('NEW')}`);
console.log(`no manifest url: ${candidates.filter(c => !c.manifest_url).length}`);

writeFileSync(OUT, JSON.stringify(candidates, null, 1));
console.log('wrote', OUT);
await client.close();
