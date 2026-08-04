#!/usr/bin/env node
/**
 * Audit the bibliographic provenance layer (`books.field_provenance`).
 *
 * `.claude/docs/data-provenance.md` documents and verifies the AI-text chain
 * (prompts → model → page text → revisions → gemini_usage) and concludes
 * "Known gaps: None". That is true of the layer it covers — and that layer is
 * only half the system. The bibliographic layer, which backs every citation
 * claim (who holds this book, what year, who printed it) and is rendered to
 * readers by BibliographicInfo.tsx, had no documentation, no shared writer, and
 * no audit at all until this script.
 *
 * It reports four things, each a distinct failure mode:
 *
 *   1. COVERAGE     — values carrying no stamp. "We don't know where this came
 *                     from", per field.
 *   2. SHAPE        — 81 writers hand-rolling stamps produced 164 key-shapes.
 *                     Stamps that omit `script` cannot be traced to code;
 *                     stamps that omit `previous_value` destroy what they
 *                     replaced.
 *   3. CONTRADICTED — the stamp asserts an upstream method that could not have
 *                     produced the value now stored. This is the dangerous
 *                     class: a false claim of provenance reads as authority and
 *                     stops anyone looking. It is how 1,304 books came to say
 *                     "Internet Archive" under a stamp claiming `ia_metadata`.
 *   4. HISTORY      — how much of the corpus has an append-only chain, so a
 *                     repeat sweep cannot erase an earlier previous_value.
 *
 * Read-only. Exits non-zero with --strict if contradicted stamps exist.
 *
 *   set -a; source .env.production.local; set +a; node scripts/audit/field-provenance.mjs
 *   node scripts/audit/field-provenance.mjs --field contributing_library
 *   node scripts/audit/field-provenance.mjs --strict
 */

import { MongoClient } from 'mongodb';
import { holdingLibraryName } from '../lib/holding-library.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const STRICT = has('--strict');
const ONLY_FIELD = val('--field', null);

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is required:\n  set -a; source .env.production.local; set +a; node scripts/audit/field-provenance.mjs');
  process.exit(1);
}

/**
 * Bibliographic fields a citation depends on, paired with the stamp key that
 * should describe them. The value path and the stamp key differ often enough
 * (`place_published` → `place_of_publication`) that they must be listed, not
 * derived.
 */
const CITATION_FIELDS = [
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
const CONTRADICTIONS = {
  // A stamp claiming IA/catalog metadata, on a value the resolver rejects as a
  // host or non-library. IA's metadata names a contributor; it never returns
  // "Internet Archive" as the holding institution for a library-scanned book.
  contributing_library: (entry, value) => {
    if (typeof value !== 'string' || !value.trim()) return false;
    const claims = typeof entry?.method === 'string' && /metadata|catalog|manifest/i.test(entry.method);
    return claims && !holdingLibraryName({ contributing_library: value });
  },
};

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const books = client.db('bookstore').collection('books');
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
    { projection: { field_provenance: 1, field_provenance_history: 1, image_source: 1, slug: 1 } },
  );

  let entries = 0, withScript = 0, withPrev = 0, withDate = 0, noSource = 0, withHistory = 0;
  const shapes = new Map();
  const contradicted = new Map();
  const disputed = new Map();
  const contradictedExamples = [];

  for await (const b of cursor) {
    const fp = b.field_provenance || {};
    if (b.field_provenance_history && Object.keys(b.field_provenance_history).length) withHistory++;
    for (const [field, entry] of Object.entries(fp)) {
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
        const value = field === 'contributing_library' ? b.image_source?.contributing_library : undefined;
        if (detect(entry, value)) {
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

  console.log('');
  await client.close();
  if (STRICT && totalContradicted > 0) {
    console.error(`FAIL: ${totalContradicted} contradicted provenance stamps.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
