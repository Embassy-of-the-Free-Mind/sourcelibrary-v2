#!/usr/bin/env npx tsx
/**
 * Audit the bibliographic provenance layer (`books.field_provenance`).
 *
 * PRIOR ART: scripts/audit/provenance-coverage.mjs — audits the AI-OUTPUT layer
 * (the `engine` block on page text); it never reads `books.field_provenance`.
 * scripts/audit/artwork-title-provenance.mjs covers one field on artwork
 * records. This is the audit from the unmerged #3445, recovered for #3471.
 *
 * `.claude/docs/data-provenance.md` sections 1-9 document and verify the AI-text
 * chain (prompts → model → page text → revisions → gemini_usage). The
 * bibliographic layer backs every citation claim (who holds this book, what
 * year, who printed it) and is rendered to readers by BibliographicInfo.tsx.
 *
 * It reports five things, each a distinct failure mode:
 *
 *   1. COVERAGE     — values carrying no stamp. "We don't know where this came
 *                     from", per field.
 *   2. SHAPE        — many writers hand-rolling stamps produce many key-shapes.
 *                     Stamps that omit `script` cannot be traced to code;
 *                     stamps that omit `previous_value` destroy what they
 *                     replaced.
 *   3. CONTRADICTED — the stamp asserts an upstream method that could not have
 *                     produced the value now stored. This is the dangerous
 *                     class: a false claim of provenance reads as authority and
 *                     stops anyone looking. It is how 1,124 books came to say
 *                     "Internet Archive" under a stamp claiming `ia_metadata`.
 *   4. HISTORY      — how much of the corpus has an append-only chain, so a
 *                     repeat sweep cannot erase an earlier previous_value.
 *   5. NEW WRITES   — of the titles and authors written in the last week, how
 *                     many carry a stamp (#7673). Sections 1-4 move slowly and a
 *                     backfill moves them most; this is the one that says whether
 *                     today's writers are recording where a value came from.
 *
 * Read-only. Population: live books (`visible: true && pages_count > 0`), except
 * section 5, which counts every book: imports write their titles while hidden.
 * Exit 1 with --strict if unmarked contradicted stamps exist; 2 = could not
 * measure (no MONGODB_URI), which is not a pass.
 *
 *   npx tsx --env-file=.env.production.local scripts/audit/field-provenance.ts
 *   npx tsx --env-file=.env.production.local scripts/audit/field-provenance.ts --field contributing_library
 *   npx tsx --env-file=.env.production.local scripts/audit/field-provenance.ts --strict
 *   npx tsx --env-file=.env.production.local scripts/audit/field-provenance.ts --days 30   # window for section 5 (default 7)
 */

import { readFileSync } from 'node:fs';
import { MongoClient, ObjectId } from 'mongodb';
// Imported, not reimplemented: the detector must not drift from the rule the
// citation surfaces use to decide "this names a host, not a holder".
import { copyClause } from '../../src/lib/holding-library';
import { isNewWriteStamp, isStampContradicted } from '../../src/lib/field-provenance';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string, d: string | null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const STRICT = has('--strict');
const ONLY_FIELD = val('--field', null);
const DAYS = Number(val('--days', '7'));

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is required:\n  npx tsx --env-file=.env.production.local scripts/audit/field-provenance.ts');
  process.exit(2);
}

/**
 * Bibliographic fields a citation depends on, paired with the stamp key that
 * should describe them. The value path and the stamp key differ often enough
 * (`place_published` → `place_of_publication`) that they must be listed, not
 * derived.
 */
const CITATION_FIELDS: Array<[string, string]> = [
  ['title', 'title'],
  ['author', 'author'],
  ['year', 'year'],
  ['published', 'published'],
  ['language', 'language'],
  ['publisher', 'publisher'],
  ['display_title', 'display_title'],
  ['place_published', 'place_of_publication'],
  ['image_source.contributing_library', 'contributing_library'],
  ['is_first_translation', 'is_first_translation'],
];

/**
 * Per-field detectors for "this stamp cannot describe this value".
 * Only add a rule you can defend: a false NEGATIVE here is invisible, but a
 * false POSITIVE sends someone rewriting correct data.
 */
type Entry = Record<string, unknown> & { source?: unknown; method?: string; disputed?: unknown; date?: unknown };
type BookDoc = {
  id?: string;
  slug?: string;
  created_at?: Date;
  title?: unknown;
  display_title?: unknown;
  english_title?: unknown;
  author?: unknown;
  contributing_library?: string;
  image_source?: { contributing_library?: string };
  field_provenance?: Record<string, unknown>;
  field_provenance_history?: Record<string, unknown>;
};

const CONTRADICTIONS: Record<string, { value: (b: BookDoc) => unknown; placeholder: (v: string) => boolean }> = {
  // A stamp claiming IA/catalog metadata, on a value the citation layer rejects
  // as an aggregator or null-holder token. IA's metadata names a contributor;
  // it never returns "Internet Archive" as the holder of a library-scanned book.
  contributing_library: {
    value: (b) => b.image_source?.contributing_library || b.contributing_library,
    placeholder: (v) => copyClause(v) === null,
  },
};

/** The fields gated in CI by #7673. Each one's value path and stamp key are the same. */
const GATED_TITLE_FIELDS = ['title', 'display_title', 'english_title', 'author'];

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const books = client.db('bookstore').collection<BookDoc>('books');
  const vis = { visible: true, pages_count: { $gt: 0 } };

  const total = await books.countDocuments(vis);
  const withProv = await books.countDocuments({ ...vis, field_provenance: { $exists: true, $ne: {} } });
  console.log(`\nBIBLIOGRAPHIC PROVENANCE AUDIT  (books.field_provenance)`);
  console.log(`visible books with pages: ${total}`);
  console.log(`  carrying any field_provenance: ${withProv} (${pct(withProv, total)})\n`);

  // ---- 1. COVERAGE -------------------------------------------------------
  console.log('1. COVERAGE — values with no stamp at all');
  console.log('   ' + 'field'.padEnd(34) + 'value'.padStart(9) + 'stamped'.padStart(9) + 'UNPROVENANCED'.padStart(18));
  const fields = ONLY_FIELD ? CITATION_FIELDS.filter(([, k]) => k === ONLY_FIELD) : CITATION_FIELDS;
  for (const [valuePath, stampKey] of fields) {
    const hasValue = await books.countDocuments({ ...vis, [valuePath]: { $exists: true, $nin: [null, ''] } });
    const stamped = await books.countDocuments({
      ...vis,
      [valuePath]: { $exists: true, $nin: [null, ''] },
      [`field_provenance.${stampKey}`]: { $exists: true },
    });
    const gap = hasValue - stamped;
    console.log('   ' + valuePath.padEnd(34) + String(hasValue).padStart(9) + String(stamped).padStart(9) + `${gap} (${pct(gap, hasValue)})`.padStart(18));
  }

  // ---- 2/3/4. one pass over the stamped corpus ---------------------------
  const cursor = books.find(
    { ...vis, field_provenance: { $exists: true, $ne: {} } },
    { projection: { field_provenance: 1, field_provenance_history: 1, image_source: 1, contributing_library: 1, slug: 1 } },
  ).batchSize(1000);

  let entries = 0, withScript = 0, withPrev = 0, withDate = 0, noSource = 0, withHistory = 0;
  const shapes = new Map<string, number>();
  const contradicted = new Map<string, number>();
  const disputed = new Map<string, number>();
  const contradictedExamples: string[] = [];

  for await (const b of cursor) {
    const fp = b.field_provenance || {};
    if (b.field_provenance_history && Object.keys(b.field_provenance_history).length) withHistory++;
    for (const [field, raw] of Object.entries(fp)) {
      const entry = raw as Entry;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      entries++;
      if (typeof entry.source === 'string' && entry.source.trim()) { /* ok */ } else noSource++;
      if ('script' in entry) withScript++;
      if ('previous_value' in entry) withPrev++;
      if ('date' in entry) withDate++;
      const shape = Object.keys(entry).sort().join(',');
      shapes.set(shape, (shapes.get(shape) || 0) + 1);

      const detect = CONTRADICTIONS[field];
      if (detect) {
        const value = detect.value(b);
        if (isStampContradicted(entry as never, value, detect.placeholder)) {
          // A claim explicitly marked disputed is a DIFFERENT state from one
          // still asserting itself: the record now says "this provenance is
          // not supported" instead of vouching for it. Counting the two
          // together would mean honest remediation could never move the
          // number, which trains people to ignore the audit.
          if (entry.disputed) {
            disputed.set(field, (disputed.get(field) || 0) + 1);
            continue;
          }
          contradicted.set(field, (contradicted.get(field) || 0) + 1);
          if (contradictedExamples.length < 8) {
            contradictedExamples.push(`${b.slug} — ${field}: value=${JSON.stringify(value)} stamp=${JSON.stringify({ source: entry.source, method: entry.method, date: entry.date })}`);
          }
        }
      }
    }
  }

  console.log('\n2. SHAPE — can a stamp be traced, and did it preserve what it replaced?');
  console.log(`   stamped field-entries      ${entries}`);
  console.log(`   distinct key-shapes        ${shapes.size}   (one shared writer would produce a handful)`);
  console.log(`   with a date                ${withDate} (${pct(withDate, entries)})`);
  console.log(`   naming the script          ${withScript} (${pct(withScript, entries)})`);
  console.log(`   recording previous_value   ${withPrev} (${pct(withPrev, entries)})`);
  console.log(`   MISSING \`source\`           ${noSource}   (the one mandatory key)`);

  const totalContradicted = [...contradicted.values()].reduce((a, c) => a + c, 0);
  const totalDisputed = [...disputed.values()].reduce((a, c) => a + c, 0);
  console.log('\n3. CONTRADICTED — stamp asserts a method that cannot have produced this value');
  if (!totalContradicted) console.log('   unmarked: none');
  for (const [field, n] of [...contradicted].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(6)}  ${field}  (still asserting)`);
  if (totalDisputed) {
    console.log('   already marked `disputed` — claim withdrawn, value still unverified:');
    for (const [field, n] of [...disputed].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(6)}  ${field}`);
  }
  if (contradictedExamples.length) {
    console.log('\n   examples:');
    contradictedExamples.forEach((e) => console.log(`     ${e}`));
  }

  console.log('\n4. HISTORY — append-only chain, so a repeat sweep cannot erase an earlier previous_value');
  console.log(`   books with field_provenance_history: ${withHistory} (${pct(withHistory, withProv)})`);

  // ---- 5. NEW WRITES -----------------------------------------------------
  // A write that leaves no stamp also leaves no date on the book, so "written
  // this week" has to be assembled from the three places a write does show:
  // the book's creation, a dated stamp, and a book_metadata_changelog row.
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const newWriteFields = ONLY_FIELD ? GATED_TITLE_FIELDS.filter((k) => k === ONLY_FIELD) : GATED_TITLE_FIELDS;
  const tally = new Map(newWriteFields.map((k) => [k, { created: 0, createdStamped: 0, editStamped: 0, editUnstamped: 0 }]));
  const stampOf = (b: BookDoc, k: string) => b.field_provenance?.[k] as Parameters<typeof isNewWriteStamp>[0];

  const created = books.find({ created_at: { $gte: since } }, {
    projection: { ...Object.fromEntries(newWriteFields.flatMap((k) => [[k, 1], [`field_provenance.${k}`, 1]])) },
  }).batchSize(1000);
  for await (const b of created) {
    for (const [k, t] of tally) {
      if (b[k as keyof BookDoc] === undefined || b[k as keyof BookDoc] === null || b[k as keyof BookDoc] === '') continue;
      t.created++;
      if (stampOf(b, k)) t.createdStamped++;
    }
  }

  // Dates are stored as both Date and string, and Mongo compares within a type.
  const stampedEdits = books.find({
    $or: newWriteFields.flatMap((k) => [
      { [`field_provenance.${k}.date`]: { $gte: since } },
      { [`field_provenance.${k}.date`]: { $gte: since.toISOString() } },
    ]),
    created_at: { $not: { $gte: since } },
  }, { projection: Object.fromEntries(newWriteFields.map((k) => [`field_provenance.${k}`, 1])) }).batchSize(1000);
  for await (const b of stampedEdits) {
    for (const [k, t] of tally) if (isNewWriteStamp(stampOf(b, k), since)) t.editStamped++;
  }

  const changelog = await client.db('bookstore').collection('book_metadata_changelog').find({
    $or: [{ timestamp: { $gte: since } }, { timestamp: { $gte: since.toISOString() } }],
    'changes.field': { $in: newWriteFields },
  }, { projection: { book_id: 1, source: 1, 'changes.field': 1 } }).toArray();
  const changelogIds = [...new Set(changelog.map((r) => String(r.book_id)))];
  // By `id` OR `_id`: 16,343 books have a re-minted `_id` (book-deletion-and-identity.md).
  const changed = await books.find({
    $or: [{ id: { $in: changelogIds } }, { _id: { $in: changelogIds.filter((i) => ObjectId.isValid(i)).map((i) => new ObjectId(i)) } }],
  } as never, { projection: { id: 1, created_at: 1, ...Object.fromEntries(newWriteFields.map((k) => [`field_provenance.${k}`, 1])) } }).toArray();
  const changedById = new Map(changed.flatMap((b) => [[String(b.id), b], [String(b._id), b]]));
  const seen = new Set<string>();
  const unstampedBy = new Map<string, number>();
  for (const row of changelog) {
    const b = changedById.get(String(row.book_id));
    if (!b || (b.created_at && b.created_at >= since)) continue; // gone, or already counted as created
    for (const { field } of row.changes as Array<{ field: string }>) {
      const t = tally.get(field);
      const key = `${String(b._id)}:${field}`;
      if (!t || seen.has(key) || isNewWriteStamp(stampOf(b, field), since)) continue;
      seen.add(key);
      t.editUnstamped++;
      unstampedBy.set(String(row.source), (unstampedBy.get(String(row.source)) || 0) + 1);
    }
  }

  console.log(`\n5. NEW WRITES — last ${DAYS} days, every book including hidden (since ${since.toISOString().slice(0, 10)})`);
  console.log('   ' + 'field'.padEnd(15) + 'new books'.padStart(10) + 'stamped'.padStart(9) + 'edits'.padStart(8) + 'stamped'.padStart(9) + 'COVERAGE'.padStart(24));
  for (const [k, t] of tally) {
    const edits = t.editStamped + t.editUnstamped;
    const written = t.created + edits;
    const stamped = t.createdStamped + t.editStamped;
    console.log('   ' + k.padEnd(15) + String(t.created).padStart(10) + String(t.createdStamped).padStart(9) + String(edits).padStart(8) + String(t.editStamped).padStart(9) + `${stamped}/${written} (${pct(stamped, written)})`.padStart(24));
  }
  if (unstampedBy.size) {
    console.log('   edits with no stamp, by book_metadata_changelog source:');
    for (const [source, n] of [...unstampedBy].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ${String(n).padStart(6)}  ${source}`);
  }
  console.log('   Reconstructed stamps are excluded: they attest a stored value, they wrote nothing.');
  console.log('   Coverage is an UPPER bound: an unstamped edit by a script that writes no changelog row leaves no trace.');
  const accepted: string[] = JSON.parse(readFileSync('scripts/lib/imprint-write-baseline.json', 'utf8')).accepted;
  const stillOutside = newWriteFields.map((k) => `${k} ${accepted.filter((id) => id.endsWith(`::${k}`)).length}`).join(', ');
  console.log(`   Writers still outside setCatalogueFields (the baseline; may only shrink): ${stillOutside}`);

  console.log('');
  await client.close();
  if (STRICT && totalContradicted > 0) {
    console.error(`FAIL: ${totalContradicted} contradicted provenance stamps.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
