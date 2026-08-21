#!/usr/bin/env node
/**
 * Standing audit: which `authors.variants[]` strings are unsafe to MATCH on?
 * (#3894 follow-up)
 *
 * A variant is another way of writing one person's name, and the identity layer
 * treats it as a lookup key — the read-path resolver, the canonical-link
 * backfill, `nominativise.mjs` and `author-vs-ai-metadata.mjs` all match
 * incoming strings against it. So a variant that names several people, or a
 * contributor, or an edition, is not inert debris: it is a trapdoor onto the
 * wrong person.
 *
 * It has already fired. The `cicero` doc carries "Cicero (ed. Manutius family)",
 * which is why a title page reading "Aldi Manvtii" resolved to Cicero.
 *
 * WHAT THIS DOES NOT PROPOSE. Deleting them, for two reasons the report makes
 * measurable:
 *
 *   1. A compound may be the only record that a volume had co-authors —
 *      information the contents layer (#2916) wants, not debris.
 *   2. **Books join their author doc by matching `books.author` against these
 *      strings.** Removing a variant that books still carry ORPHANS them: the
 *      byline stays, the author page silently loses the book. So every unsafe
 *      variant is reported with the number of books that would be cut loose,
 *      and that number is the whole risk picture.
 *
 * The safe repair is to stop matching on these (a `matchable` flag consumers
 * respect), not to erase them.
 *
 * Read-only. Exits 1 when any unsafe variant is load-bearing for a book.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/thesaurus-variant-shape.mjs
 *   node scripts/audit/thesaurus-variant-shape.mjs --json
 *   node scripts/audit/thesaurus-variant-shape.mjs --shape=multi_person
 */
import { MongoClient } from 'mongodb';
import { classifyVariant } from '../lib/variant-shape.mjs';

const JSON_OUT = process.argv.includes('--json');
const ONLY = (process.argv.find((a) => a.startsWith('--shape=')) || '').split('=')[1] || null;
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const authors = db.collection('authors');
const books = db.collection('books');

const shapes = { multi_person: [], role_annotated: [], edition_annotated: [], overlong: [] };
const benign = { script_pair: 0, institutional: 0 };
let totalVariants = 0; let cleanCount = 0; let docsAffected = 0;

for await (const a of authors.find({ variants: { $exists: true, $ne: [] } },
  { projection: { canonical_name: 1, variants: 1, wikidata_id: 1 } })) {
  let touched = false;
  for (const v of a.variants) {
    totalVariants++;
    const c = classifyVariant(v);
    if (c.matchable) {
      cleanCount++;
      if (benign[c.shape] !== undefined) benign[c.shape]++;
      continue;
    }
    touched = true;
    shapes[c.shape].push({
      slug: a._id,
      canonical_name: a.canonical_name || a._id,
      wikidata_id: a.wikidata_id ?? null,
      variant: v,
      people: c.people,
    });
  }
  if (touched) docsAffected++;
}

// How many books would actually be CUT LOOSE if a variant stopped matching?
//
// The first version of this counted books whose `author` equals the variant and
// called all 1,526 of them load-bearing. That conflated CARRYING the string with
// DEPENDING on it. A book with an explicit `author_id` reaches its author by
// foreign key and does not care what the variant says; only a book with NO
// author_id is held on by the string alone.
//
// Measured against production the true figure is ZERO — the canonical-link
// backfill already gave every one of them an FK — which inverts the conclusion:
// de-matching these variants is SAFE today, and the earlier "1,526 books at
// risk" was an artefact of the wrong denominator.
const flat = Object.values(shapes).flat();
const distinct = [...new Set(flat.map((r) => r.variant))];
const carried = new Map();
const orphaning = new Map();
for (const v of distinct) {
  carried.set(v, await books.countDocuments({ author: v }));
  orphaning.set(v, await books.countDocuments({
    author: v,
    $or: [{ author_id: { $exists: false } }, { author_id: null }, { author_id: '' }],
  }));
}
for (const r of flat) {
  r.books_carrying = carried.get(r.variant) ?? 0;
  r.books_orphaned_if_dematched = orphaning.get(r.variant) ?? 0;
}

const loadBearing = flat.filter((r) => r.books_orphaned_if_dematched > 0);
const booksAtRisk = loadBearing.reduce((s, r) => s + r.books_orphaned_if_dematched, 0);
const booksCarrying = flat.reduce((s, r) => s + r.books_carrying, 0);

// A single variant claimed by SEVERAL docs is a duplicate-author signal: the
// same person exists twice and both copies list the string. Surfaced here
// because this audit is already walking every variant.
const claimants = new Map();
for await (const a of authors.find({ variants: { $exists: true, $ne: [] } },
  { projection: { canonical_name: 1, variants: 1, wikidata_id: 1 } })) {
  for (const v of a.variants) {
    if (!claimants.has(v)) claimants.set(v, []);
    claimants.get(v).push({ slug: a._id, wikidata_id: a.wikidata_id ?? null });
  }
}
const contested = [...claimants.entries()]
  .filter(([, d]) => d.length > 1)
  .map(([variant, docs]) => ({ variant, docs }));

if (JSON_OUT) {
  console.log(JSON.stringify({
    variants_total: totalVariants,
    clean: cleanCount,
    benign_shapes: benign,
    unsafe: flat.length,
    docs_affected: docsAffected,
    books_carrying_an_unsafe_variant: booksCarrying,
    load_bearing_variants: loadBearing.length,
    books_orphaned_if_dematched: booksAtRisk,
    contested_variants: contested,
    counts: Object.fromEntries(Object.entries(shapes).map(([k, v]) => [k, v.length])),
    shapes: ONLY ? { [ONLY]: shapes[ONLY] ?? [] } : shapes,
  }, null, 2));
} else {
  log('══ authors.variants[] — shape audit ══\n');
  log(`  variants total   : ${totalVariants.toLocaleString()}`);
  log(`  safe to match on : ${cleanCount.toLocaleString()} (${(100 * cleanCount / totalVariants).toFixed(1)}%)`);
  log(`    …of which ${benign.script_pair} are transliteration pairs (one person, two scripts)`);
  log(`    …and ${benign.institutional} are institutional headings containing "&"`);
  log(`  UNSAFE           : ${flat.length.toLocaleString()} across ${docsAffected.toLocaleString()} docs\n`);
  for (const [k, v] of Object.entries(shapes)) log(`    ${k.padEnd(18)} ${String(v.length).padStart(5)}`);

  log(`\n  books carrying an unsafe variant : ${booksCarrying}`);
  log(`  …that would be ORPHANED by de-matching it : ${booksAtRisk}`);
  if (booksAtRisk === 0) {
    log('    → every one already has an explicit author_id, so de-matching is SAFE.');
    log('      Carrying a string is not the same as depending on it.');
  } else {
    log(`    → ${loadBearing.length} variants are the ONLY link for those books.`);
    log('      Give them an author_id BEFORE de-matching, or the byline stays');
    log('      and the author page silently loses the book.');
  }
  log(`\n  variant strings claimed by MORE THAN ONE doc: ${contested.length}`);
  log('    each is a duplicate-author signal — the same person exists twice');
  for (const c of contested.slice(0, 8)) {
    log(`      ${JSON.stringify(c.variant.slice(0, 46))}`);
    log(`         ${c.docs.map((d) => `${d.slug}${d.wikidata_id ? ` [${d.wikidata_id}]` : ''}`).join('  ⟷  ')}`);
  }

  for (const [name, rows] of Object.entries(shapes)) {
    if (ONLY && name !== ONLY) continue;
    log(`\n\n══ ${name} — ${rows.length} ══`);
    const show = rows.sort((a, b) => b.books_carrying - a.books_carrying).slice(0, 12);
    for (const r of show) {
      log(`  ${r.books_carrying > 0 ? `[${r.books_carrying} books] ` : '            '}${r.canonical_name.slice(0, 30).padEnd(30)} ${r.wikidata_id ?? ''}`);
      log(`     ${JSON.stringify(String(r.variant).slice(0, 96))}`);
      if (name === 'multi_person' && r.people.length > 1) log(`     → ${r.people.length} people: ${r.people.slice(0, 4).join(' · ')}`);
    }
    if (rows.length > 12) log(`  … ${rows.length - 12} more`);
  }

  log('\n\n══ SUMMARY ══');
  log(`  ${flat.length} variants should not be used as lookup keys.`);
  log(`  ${booksAtRisk} books would be orphaned by de-matching them (${booksCarrying} merely carry one).`);
  log(`  ${contested.length} strings are claimed by two docs — duplicate people to merge.`);
  log('  The multi_person splits are candidate co-author records for #2916,');
  log('  not garbage: keep the information, stop matching on the string.');
}

await mc.close();
process.exit(loadBearing.length === 0 && contested.length === 0 ? 0 : 1);
