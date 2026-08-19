#!/usr/bin/env node
/**
 * Backfill `authors.aliases[]` from Wikidata labels + aliases. (#4037, ladder step 1)
 *
 * WHY: 4,586 of 6,291 authors carry a `wikidata_id`, but no author holds the
 * multilingual name forms those QIDs entitle us to — so artwork cross-reference
 * names ("Erasmus of Rotterdam") miss catalogue forms ("Erasmus von Rotterdam")
 * that Wikidata knows are the same person. This is a fetch, not a model.
 *
 * `aliases` is a NEW field on `authors`: external-authority name forms, kept
 * deliberately separate from `variants[]` (catalogue-observed forms, which
 * drive /author/ URL resolution and carry their own provenance). Nothing in
 * src/ reads `authors.aliases` today, so writing it actuates nothing.
 *
 * Every QID's P31 is verified before its aliases are trusted
 * (lesson_verify_every_wikidata_qid: an id that denotes a WORK or an EDITION
 * instead of a person is a real and observed failure). Non-person P31s are
 * never written; they land in the report as suspect wikidata_ids.
 *
 *   node --env-file=.env.production.local scripts/artwork-links/backfill-author-aliases.mjs           (dry run)
 *   node --env-file=.env.production.local scripts/artwork-links/backfill-author-aliases.mjs --apply
 *
 * Writes (with --apply): authors.aliases[] + one sweep_log row per author.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'author-aliases-wikidata-2026-08';
const OUT = 'scripts/output/author-aliases-backfill-report.json';

// Name-form languages that actually occur in our catalogue + enrichment output.
const LANGS = 'en|de|fr|it|nl|es|pt|la|el|grc|cs|pl|sv|da|hu|ru';

// P31 values we accept as "this QID denotes a person (or person-shaped
// tradition-bearer our catalogue legitimately files as an author)".
const PERSON_P31 = new Map([
  ['Q5', 'human'],
  ['Q20643955', 'human biblical figure'],
  ['Q21070568', 'human whose existence is disputed'],
  ['Q22988604', 'legendary figure'],
  ['Q4271324', 'mythical character'],
]);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const authors = db.collection('authors');

const docs = await authors
  .find(
    { wikidata_id: { $exists: true, $nin: [null, ''] } },
    { projection: { canonical_name: 1, variants: 1, wikidata_id: 1, aliases: 1 } },
  )
  .toArray();
console.error(`${docs.length} authors carry a wikidata_id`);

// Several authors can share one QID (duplicate headings); fetch each QID once.
const byQid = new Map();
for (const d of docs) {
  const qid = String(d.wikidata_id).trim();
  if (!/^Q\d+$/.test(qid)) {
    console.error(`  malformed wikidata_id ${JSON.stringify(qid)} on ${d._id} — skipped`);
    continue;
  }
  if (!byQid.has(qid)) byQid.set(qid, []);
  byQid.get(qid).push(d);
}
const qids = [...byQid.keys()];
console.error(`${qids.length} distinct QIDs to fetch`);

const entities = new Map(); // qid -> wbgetentities entity (or {missing})
for (let i = 0; i < qids.length; i += 50) {
  const batch = qids.slice(i, i + 50);
  const url =
    'https://www.wikidata.org/w/api.php?action=wbgetentities' +
    `&ids=${batch.join('|')}&props=labels|aliases|claims&languages=${LANGS}` +
    '&format=json&maxlag=5';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SourceLibraryBot/1.0 (https://sourcelibrary.org)' },
  });
  if (!res.ok) throw new Error(`wbgetentities HTTP ${res.status} on batch at ${i}`);
  const data = await res.json();
  if (data.error) throw new Error(`wbgetentities error: ${JSON.stringify(data.error)}`);
  for (const [id, ent] of Object.entries(data.entities || {})) entities.set(id, ent);
  process.stderr.write(`\r  fetched ${Math.min(i + 50, qids.length)}/${qids.length}`);
  await new Promise((r) => setTimeout(r, 250));
}
console.error('');

const p31Of = (ent) =>
  (ent?.claims?.P31 || [])
    .map((c) => c?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);

const norm = (s) => String(s || '').normalize('NFC').trim().toLowerCase();

const report = {
  generated_at: new Date().toISOString(),
  apply: APPLY,
  authors_with_qid: docs.length,
  distinct_qids: qids.length,
  written: 0,
  no_new_aliases: 0,
  suspect_non_person: [], // wikidata_id does not denote a person — do NOT trust it
  missing_or_redirected: [],
  p31_distribution: {},
};

let writes = 0;
for (const [qid, authorDocs] of byQid) {
  const ent = entities.get(qid);
  if (!ent || ent.missing !== undefined) {
    report.missing_or_redirected.push({ qid, authors: authorDocs.map((d) => d._id) });
    continue;
  }
  const p31 = p31Of(ent);
  for (const p of p31.length ? p31 : ['(none)']) {
    report.p31_distribution[p] = (report.p31_distribution[p] || 0) + 1;
  }
  const accepted = p31.some((p) => PERSON_P31.has(p));
  if (!accepted) {
    report.suspect_non_person.push({
      qid,
      p31,
      authors: authorDocs.map((d) => ({ id: d._id, name: d.canonical_name })),
    });
    continue;
  }

  const forms = [];
  for (const l of Object.values(ent.labels || {})) forms.push(l.value);
  for (const arr of Object.values(ent.aliases || {})) for (const a of arr) forms.push(a.value);

  for (const doc of authorDocs) {
    const known = new Set([norm(doc.canonical_name), ...(doc.variants || []).map(norm)]);
    const seen = new Set();
    const fresh = [];
    for (const f of forms) {
      const n = norm(f);
      if (!n || n.length < 3 || known.has(n) || seen.has(n)) continue;
      seen.add(n);
      fresh.push(f.normalize('NFC').trim());
      if (fresh.length >= 60) break;
    }
    if (!fresh.length) {
      report.no_new_aliases++;
      continue;
    }
    if (APPLY) {
      const r = await authors.updateOne({ _id: doc._id }, { $set: { aliases: fresh } });
      if (r.modifiedCount !== 1 && r.matchedCount !== 1) {
        throw new Error(`update did not match author ${doc._id}`);
      }
      await recordSweepAction(db, {
        sweep: SWEEP,
        book_id: String(doc._id),
        action: 'aliases-backfilled',
        detail: { collection: 'authors', qid, alias_count: fresh.length },
      });
      writes++;
    } else {
      writes++; // dry-run: count what WOULD be written
    }
  }
}
report.written = writes;

mkdirSync('scripts/output', { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));

console.error(`\n${APPLY ? 'WROTE' : 'DRY RUN — would write'} aliases on ${writes} authors`);
console.error(`no new forms: ${report.no_new_aliases}`);
console.error(`suspect non-person QIDs: ${report.suspect_non_person.length}`);
console.error(`missing/redirected QIDs: ${report.missing_or_redirected.length}`);
console.error(`report: ${OUT}`);
if (!APPLY) console.error('\nNothing written. Re-run with --apply after reading the report.');
await client.close();
