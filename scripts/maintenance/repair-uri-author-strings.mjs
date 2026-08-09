#!/usr/bin/env node
/**
 * Repair books whose `author` field is an authority URI instead of a name —
 * "http://data.europeana.eu/agent/145435" (74 books; that agent is Paracelsus)
 * or "https://d-nb.info/gnd/118522833" (Croll) etc. Found during the #3780
 * enumeration; same import wave as #3770, a sibling shape of the same bug:
 * the harvest driver copied a linked-data reference where a literal belongs.
 *
 * These are EXACTLY recoverable — the URI is an authority record:
 *   - GND: https://lobid.org/gnd/{id}.json -> preferredName
 *   - Europeana entity: the URI itself content-negotiates JSON -> prefLabel.en/de
 * The resolved name is written to author, identity fields are restamped via
 * the shared computeIdentityFields, and the URI is preserved in
 * field_provenance.author. Slug is regenerated only for hidden books.
 * work_id fields are unset when the polluted author leaked into them.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-uri-author-strings.mjs            # dry-run
 *   node --env-file=.env.production.local scripts/maintenance/repair-uri-author-strings.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { appendFileSync, mkdirSync } from 'node:fs';
import { computeIdentityFields } from '../lib/identity-fields.mjs';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/output/uri-author-repair-backup.jsonl';
const UA = 'SourceLibrary-uri-author-repair/1.0 (https://sourcelibrary.org)';

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const books = mc.db('bookstore').collection('books');

const slugify = (text, maxLength) => {
  let s = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  if (s.length > maxLength) {
    s = s.substring(0, maxLength);
    const h = s.lastIndexOf('-');
    if (h > maxLength * 0.5) s = s.substring(0, h);
  }
  return s;
};
const lastName = (a) => a.includes(',') ? a.split(',')[0].trim() : a.trim().split(/\s+/).pop();

async function resolveUri(uri) {
  const gnd = uri.match(/d-nb\.info\/gnd\/([\w-]+)/)?.[1];
  if (gnd) {
    // d-nb.info's own JSON-LD; lobid.org is unreachable from some networks.
    const r = await fetch(`https://d-nb.info/gnd/${gnd}/about/lds.jsonld`, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`d-nb ${r.status}`);
    const d = await r.json();
    const nodes = d['@graph'] || [d];
    for (const n of nodes) {
      const name = n['preferredNameForThePerson'] || n['gndo:preferredNameForThePerson']
        || n['https://d-nb.info/standards/elementset/gnd#preferredNameForThePerson'];
      const val = typeof name === 'string' ? name : name?.['@value'] || (Array.isArray(name) ? (name[0]?.['@value'] || name[0]) : null);
      if (val) {
        // GND preferred form is "Last, First" — keep it; it matches our catalog style.
        return { name: val, authority: `GND ${gnd}` };
      }
    }
    throw new Error('no preferredNameForThePerson in GND record');
  }
  if (/data\.europeana\.eu\/agent\//.test(uri)) {
    const r = await fetch(uri, { headers: { Accept: 'application/json', 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`europeana ${r.status}`);
    const d = await r.json();
    const name = d.prefLabel?.en || d.prefLabel?.de || Object.values(d.prefLabel || {})[0];
    return { name, authority: uri };
  }
  throw new Error('unrecognized authority URI');
}

const uris = await books.distinct('author', { author: /^https?:\/\// });
console.log(`${uris.length} distinct URI author strings`);

const claimed = new Set();
let repaired = 0, failed = 0;
mkdirSync('scripts/output', { recursive: true });

for (const uri of uris) {
  let resolved;
  try { resolved = await resolveUri(uri); }
  catch (e) { console.log(`  FAIL ${uri} — ${e.message}`); failed++; continue; }
  if (!resolved.name) { console.log(`  FAIL ${uri} — no name in authority record`); failed++; continue; }
  // GND preferredName is "First Last" — keep as-is; it is a display form.
  const author = resolved.name;
  const targets = await books.find({ author: uri }, { projection: { id: 1, title: 1, display_title: 1, slug: 1, published: 1, year: 1, visible: 1, work_id: 1 } }).toArray();
  console.log(`  ${uri} -> "${author}" (${targets.length} books)`);
  for (const b of targets) {
    const identity = computeIdentityFields({ ...b, author });
    let update = { author, ...identity, updated_at: new Date(),
      'field_provenance.author': { source: 'authority-uri', authority: resolved.authority, script: 'repair-uri-author-strings.mjs', date: new Date(), previous_value: uri } };
    if (b.visible !== true) {
      const base = `${slugify(b.display_title || b.title, 60)}-${slugify(lastName(author), 20)}`.replace(/^-|-$/g, '');
      let slug = base;
      for (let n = 2; claimed.has(slug) || await books.findOne({ slug, id: { $ne: b.id } }, { projection: { _id: 1 } }); n++) slug = `${base}-${n}`;
      claimed.add(slug);
      update.slug = slug;
    }
    const pollutedWork = typeof b.work_id === 'string' && /^local:n:/.test(b.work_id);
    if (!APPLY) { repaired++; continue; }
    appendFileSync(BACKUP, JSON.stringify({ id: b.id, before: { author: uri, slug: b.slug, work_id: b.work_id ?? null } }) + '\n');
    const r = await books.updateOne({ id: b.id, author: uri }, {
      $set: update,
      ...(pollutedWork ? { $unset: { work_id: '', work_slug: '', work_title: '', work_id_confidence: '', work_id_source: '' } } : {}),
    });
    if (r.modifiedCount) repaired++;
  }
  await new Promise(r => setTimeout(r, 300));
}
console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN'}: ${repaired} books repaired, ${failed} URIs unresolved.${APPLY ? ` Backup: ${BACKUP}` : ' Re-run with --apply.'}`);
await mc.close();
