#!/usr/bin/env node
/**
 * Backfill `authors.aliases[]` from Wikidata labels + aliases (#4037, ladder step 1),
 * and, since #7786, `wikidata_description` (English) and the life years
 * `wikidata_birth_year` / `wikidata_death_year` where a doc lacks them.
 *
 * WHY: 4,586 of 6,291 authors carry a `wikidata_id`, but no author holds the
 * multilingual name forms those QIDs entitle us to — so artwork cross-reference
 * names ("Erasmus of Rotterdam") miss catalogue forms ("Erasmus von Rotterdam")
 * that Wikidata knows are the same person. This is a fetch, not a model.
 *
 * `aliases` holds external-authority name forms, kept deliberately separate
 * from `variants[]` (catalogue-observed forms, which drive /author/ URL
 * resolution and carry their own provenance). READERS (so a write here is
 * visible): search name expansion (src/lib/search/name-variants.ts, #7786)
 * matches on `aliases`; the author page shows `wikidata_description` and the
 * life years where the legacy `entities` row has none (author-thesaurus.ts).
 *
 * Life years are filled, never overwritten: the grounded reconciler (#2218)
 * set some and used them as a date gate; a disagreement is reported. One
 * exception: a stored year equal to MINUS Wikidata's is a dropped BCE sign
 * (Cornelius Nepos stored as born 100) and is repaired, old value in sweep_log. A year is
 * taken only at year precision or finer (Wikidata precision >= 9).
 *
 * Wrong-PERSON guard (#7786): P31 catches a QID of the wrong KIND, never one
 * naming a different human — `jordanes` carried the painter Jordaens' QID and
 * inherited his aliases. A doc whose own name forms share no word with any
 * Wikidata label/alias is reported as `name_mismatch` and nothing is written.
 *
 * Every QID's P31 is verified before its aliases are trusted
 * (lesson_verify_every_wikidata_qid: an id that denotes a WORK or an EDITION
 * instead of a person is a real and observed failure). Non-person P31s are
 * never written; they land in the report as suspect wikidata_ids.
 *
 *   node --env-file=.env.production.local scripts/artwork-links/backfill-author-aliases.mjs           (dry run)
 *   node --env-file=.env.production.local scripts/artwork-links/backfill-author-aliases.mjs --apply
 *
 * Writes (with --apply): authors.aliases[], wikidata_description, wikidata_birth_year,
 * wikidata_death_year + one sweep_log row per author.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'author-wikidata-enrich-2026-10';
const OUT = 'scripts/output/author-wikidata-enrich-report.json';

// Name-form languages that actually occur in our catalogue + enrichment output.
const LANGS = 'en|de|fr|it|nl|es|pt|la|el|grc|cs|pl|sv|da|hu|ru|zh|ja|ko|bo|ar|fa|he|sa|hi|mul';
// `mul` is Wikidata's language-neutral default label: many recent items (the GND-minted tail,
// #7660) carry ONLY a mul label, and without it they read as a name mismatch.

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
    { projection: { canonical_name: 1, variants: 1, wikidata_id: 1, aliases: 1, wikidata_description: 1, wikidata_birth_year: 1, wikidata_death_year: 1 } },
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
    `&ids=${batch.join('|')}&props=labels|aliases|descriptions|claims&languages=${LANGS}` +
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

// Words of a name, marks folded for Latin script, for the wrong-person guard.
const words = (s) =>
  String(s || '')
    .normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 || /[^\p{Script=Latin}]/u.test(w));

// Do any of our name forms and any of Wikidata's share a word (or, for
// unspaced scripts, contain one another)?
function namesAgree(ours, theirs) {
  const ourWords = new Set(ours.flatMap(words));
  for (const t of theirs) {
    for (const w of words(t)) if (ourWords.has(w)) return true;
    const nt = norm(t);
    if (nt.length >= 2 && ours.some((o) => { const no = norm(o); return no.includes(nt) || (no.length >= 2 && nt.includes(no)); })) return true;
  }
  return false;
}

// Year of the best P569/P570 claim, or null below year precision. Preferred
// rank first; a deprecated claim is never used.
function claimYear(ent, prop) {
  const claims = (ent?.claims?.[prop] || []).filter((c) => c.rank !== 'deprecated');
  claims.sort((a, b) => (b.rank === 'preferred') - (a.rank === 'preferred'));
  for (const c of claims) {
    const v = c?.mainsnak?.datavalue?.value;
    if (!v?.time || (v.precision ?? 0) < 9) continue;
    const m = /^([+-])(\d+)-/.exec(v.time);
    if (!m) continue;
    const y = parseInt(m[2], 10) * (m[1] === '-' ? -1 : 1);
    if (Number.isFinite(y) && y !== 0) return y;
  }
  return null;
}

const report = {
  generated_at: new Date().toISOString(),
  apply: APPLY,
  authors_with_qid: docs.length,
  distinct_qids: qids.length,
  written: 0,
  no_new_aliases: 0,
  descriptions_added: 0,
  birth_years_added: 0,
  death_years_added: 0,
  year_disagreements: [], // existing year != Wikidata year — kept, reported
  bce_sign_repairs: [], // existing year == -Wikidata year: a dropped BCE sign, repaired
  name_mismatch: [], // QID names someone whose names share no word with ours — nothing written
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

  const description = ent.descriptions?.en?.value?.trim() || null;
  const birthYear = claimYear(ent, 'P569');
  const deathYear = claimYear(ent, 'P570');

  for (const doc of authorDocs) {
    if (!namesAgree([doc.canonical_name, ...(doc.variants || [])].filter(Boolean), forms)) {
      report.name_mismatch.push({ qid, id: doc._id, name: doc.canonical_name, wikidata: ent.labels?.en?.value || forms[0] || null });
      continue;
    }
    const set = {};
    if (description && !doc.wikidata_description) { set.wikidata_description = description; report.descriptions_added++; }
    for (const [field, year, counter] of [
      ['wikidata_birth_year', birthYear, 'birth_years_added'],
      ['wikidata_death_year', deathYear, 'death_years_added'],
    ]) {
      if (year == null) continue;
      if (doc[field] == null) { set[field] = year; report[counter]++; }
      else if (doc[field] === -year) {
        // An earlier writer dropped the BCE sign (Cornelius Nepos stored as born 100). Same
        // magnitude, opposite sign is that bug, not a disagreement: repair it, keep the old value.
        set[field] = year;
        report.bce_sign_repairs.push({ id: doc._id, field, was: doc[field], now: year });
      } else if (doc[field] !== year) report.year_disagreements.push({ id: doc._id, field, ours: doc[field], wikidata: year });
    }
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
    if (fresh.length) set.aliases = fresh;
    else report.no_new_aliases++;
    if (!Object.keys(set).length) continue;
    if (APPLY) {
      const r = await authors.updateOne({ _id: doc._id }, { $set: set });
      if (r.matchedCount !== 1) {
        throw new Error(`update did not match author ${doc._id}`);
      }
      await recordSweepAction(db, {
        sweep: SWEEP,
        book_id: String(doc._id),
        action: 'wikidata-enriched',
        detail: {
          collection: 'authors', qid, fields: Object.keys(set), alias_count: fresh.length,
          before: Object.fromEntries(Object.keys(set).filter((k) => k !== 'aliases').map((k) => [k, doc[k] ?? null])),
        },
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

console.error(`\n${APPLY ? 'WROTE' : 'DRY RUN — would write'} ${writes} authors`);
console.error(`descriptions +${report.descriptions_added}, birth years +${report.birth_years_added}, death years +${report.death_years_added}`);
console.error(`year disagreements (kept ours): ${report.year_disagreements.length}; BCE sign repairs: ${report.bce_sign_repairs.length}; name mismatches (skipped): ${report.name_mismatch.length}`);
console.error(`no new forms: ${report.no_new_aliases}`);
console.error(`suspect non-person QIDs: ${report.suspect_non_person.length}`);
console.error(`missing/redirected QIDs: ${report.missing_or_redirected.length}`);
console.error(`report: ${OUT}`);
if (!APPLY) console.error('\nNothing written. Re-run with --apply after reading the report.');
await client.close();
