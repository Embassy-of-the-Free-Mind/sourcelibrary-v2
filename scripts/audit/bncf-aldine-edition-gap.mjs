#!/usr/bin/env node
/**
 * How much of the BNCF Aldine "gap" is real?
 *
 * BNCF's Aldine collection on Internet Archive (`ita-bnc-ald`) has one item per
 * PHYSICAL COPY, not per edition — the 1501 Martial alone appears three times
 * (shelfmarks Ald.1.1.1, Ald.3.2.19, Ald.3.2.20). So the headline "IA has 739
 * items, we hold N" overstates what is actually missing: the residue is largely
 * second and third copies of editions already in the library.
 *
 * This script groups IA's items into EDITIONS using the bibliographic
 * fingerprint that BNCF records in `notes` (an ISBD fingerprint encodes
 * characters at fixed signature positions, so it identifies a printing), plus
 * EDIT16 CNC numbers where present. It then asks, for each item we do not
 * hold: do we already hold a different copy of that same edition?
 *
 * Read-only. Prints a summary and writes the classified list.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/bncf-aldine-edition-gap.mjs [--out FILE]
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

const OUT = process.argv.find(a => a.startsWith('--out='))?.split('=')[1] || null;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@ancientwisdomtrust.org)';

function fingerprintOf(notes) {
  const s = [].concat(notes || []).join(' ');
  const m = s.match(/Fingerprint:\s*(.+?)\s*$/i) || s.match(/Fingerprint:\s*([^|]+)/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}
function cncOf(notes) {
  const s = [].concat(notes || []).join(' ');
  return [...new Set([...s.matchAll(/CNCE?\s*([0-9]{3,7})/gi)].map(x => x[1]))];
}
// Edition identity: prefer the EDIT16 number, fall back to the fingerprint.
// Year is folded in so an accidental fingerprint collision across decades
// cannot merge two unrelated printings.
function editionKey(item) {
  const year = String(item.date || '').match(/\d{4}/)?.[0] || '?';
  const cnc = cncOf(item.notes);
  if (cnc.length) return `cnc:${cnc.sort().join('+')}`;
  const fp = fingerprintOf(item.notes);
  if (fp) return `fp:${year}:${fp.toLowerCase()}`;
  return null; // unclassifiable — counted separately, never silently merged
}

async function scrapeAll() {
  let cursor = null;
  const all = [];
  do {
    const u = new URL('https://archive.org/services/search/v1/scrape');
    u.searchParams.set('q', 'identifier:ita-bnc-ald-*');
    u.searchParams.set('fields', 'identifier,title,date,notes,shelfmark,imagecount,creator');
    u.searchParams.set('count', '1000');
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
    if (!r.ok) throw new Error(`IA scrape failed: HTTP ${r.status}`);
    const j = await r.json();
    all.push(...(j.items || []));
    cursor = j.cursor || null;
  } while (cursor);
  return all;
}

const items = await scrapeAll();
console.log(`IA ita-bnc-ald items: ${items.length}`);

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');
const held = await db.collection('books').find(
  { ia_identifier: /^ita-bnc-ald/ },
  { projection: { ia_identifier: 1, id: 1, hidden_reason: 1, visible: 1 } }
).toArray();
const heldIds = new Set(held.map(b => b.ia_identifier));
console.log(`held: ${heldIds.size}`);

// Map edition -> the IA items belonging to it
const byEdition = new Map();
let unclassifiable = 0;
for (const it of items) {
  const k = editionKey(it);
  if (!k) { unclassifiable++; continue; }
  if (!byEdition.has(k)) byEdition.set(k, []);
  byEdition.get(k).push(it);
}
console.log(`distinct editions on IA: ${byEdition.size} (from ${items.length} copies; ${unclassifiable} unclassifiable)`);

const missing = items.filter(i => !heldIds.has(i.identifier));
const dupeOfHeld = [], trulyNew = [], unknown = [];
for (const m of missing) {
  const k = editionKey(m);
  if (!k) { unknown.push({ ...m, why: 'no fingerprint or CNC in IA notes' }); continue; }
  const siblings = byEdition.get(k) || [];
  const heldSibling = siblings.find(s => s.identifier !== m.identifier && heldIds.has(s.identifier));
  if (heldSibling) dupeOfHeld.push({ id: m.identifier, title: m.title, year: String(m.date || '').slice(0, 4), held_copy: heldSibling.identifier, shelfmark: m.shelfmark, key: k });
  else trulyNew.push({ id: m.identifier, title: m.title, year: String(m.date || '').slice(0, 4), shelfmark: m.shelfmark, imagecount: m.imagecount ?? null, key: k });
}

// How many DISTINCT editions do we hold vs does IA have?
const heldEditions = new Set();
for (const [k, group] of byEdition) if (group.some(g => heldIds.has(g.identifier))) heldEditions.add(k);

console.log('\n=== THE GAP, RESTATED ===');
console.log(`IA items we do not hold:            ${missing.length}`);
console.log(`  ...another copy already held:     ${dupeOfHeld.length}`);
console.log(`  ...a genuinely unheld edition:    ${trulyNew.length}`);
console.log(`  ...unclassifiable (no fingerprint): ${unknown.length}`);
console.log(`\nEditions on IA: ${byEdition.size} | editions we hold: ${heldEditions.size} | edition-level gap: ${byEdition.size - heldEditions.size}`);

if (trulyNew.length) {
  console.log('\nUnheld editions:');
  for (const t of trulyNew.sort((a, b) => (a.year || '').localeCompare(b.year || ''))) {
    console.log(`  ${t.year} ${t.id} ${t.imagecount ? t.imagecount + 'p' : '?p'} — ${String(t.title).slice(0, 58)}`);
  }
}
if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify({ dupeOfHeld, trulyNew, unknown }, null, 2));
  console.log(`\nwrote ${OUT}`);
}
await client.close();
