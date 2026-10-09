#!/usr/bin/env node
// PRIOR ART: scripts/enrichment/merge-qid-duplicates.mjs — finds same-name+QID duplicates and
// merges them. scripts/enrichment/dedup-entities.mjs — St./Saint and parenthetical patterns on
// entities with 2+ books, then a paid model. scripts/audit/author-attribution.mjs — `authors`,
// not `entities`. None counts person records that collide after folding and Latin-case stripping.
/**
 * READ-ONLY: how many `entities` person records share a name once case, diacritics and Latin
 * case endings are set aside? (#5888)
 *
 * "Drebbel" was twenty records (Drebbelius, Drebelius, Drebel, "Drebbel, Cornelius", …). This
 * counts how common that is. It reports COUNTS ONLY and merges nothing: a collision is a
 * candidate for a by-eye look, never a verdict — "Maria", "Mario" and "Marius" collide at the
 * Latin level and are three people. Single-word names are therefore reported separately.
 *
 * Three levels, each a superset of the one before:
 *   fold    same name after case/diacritic/punctuation folding ("Drebbel, Cornelius" word order
 *           is NOT folded — that is a different, riskier equivalence)
 *   latin   …and after stripping one Latin ending per word (PRECISION_ENDINGS plus the i-stem
 *           forms -ii/-io/-ium/-ianus/-iana; 4-letter stems)
 *   alias   a record's alias equals ANOTHER record's name (folded)
 *
 * A name that folds to nothing comparable (non-Latin script through an ASCII fold, a sentinel,
 * under four letters) is UNJUDGEABLE and counted as such — never as "no collision"
 * (.claude/docs/invariants/non-latin-text-operations.md). Non-Latin names are compared on
 * their NFKC-lowercased form at the fold level only.
 *
 * Usage: node --env-file=.env.production.local scripts/audit/person-entity-name-collisions.mjs [--json]
 */
import { MongoClient } from 'mongodb';
import { foldAccents, stripEnding, PRECISION_ENDINGS } from '../lib/latin-morphology.mjs';

// PRECISION_ENDINGS has -ius but not -ii/-io/-ium, so Drebbelii would keep its "i" and miss
// Drebbel. The i-stem forms go first (longest first); the shared list follows unchanged.
const ENDINGS = ['ianus', 'iana', 'ium', 'ii', 'io', ...PRECISION_ENDINGS];
const SENTINELS = new Set(['unknown', 'anonymous', 'anon', 'untitled', 'n a', 'na', 'none', 'various', 'author', 'the author']);
const LATIN = /^[\p{Script=Latin}\p{P}\p{N}\p{Zs}\p{M}ʻʼʾʿ]+$/u;

/** @returns {{ fold: string, latin: string|null, words: number } | null} null = unjudgeable */
export function nameKeys(name) {
  if (typeof name !== 'string') return null;
  const raw = name.normalize('NFKC').trim();
  if (!raw) return null;
  if (!LATIN.test(raw)) {
    const fold = raw.toLowerCase().replace(/\s+/g, ' ');
    return Array.from(fold.replace(/\s/g, '')).length >= 2 ? { fold: `x:${fold}`, latin: null, words: fold.split(' ').length } : null;
  }
  const fold = foldAccents(raw);
  if (fold.replace(/ /g, '').length < 4 || SENTINELS.has(fold)) return null;
  const words = fold.split(' ');
  return { fold, latin: words.map(w => stripEnding(w, ENDINGS, 4)).join(' '), words: words.length };
}

function summarize(groups) {
  const sizes = { 2: 0, '3-5': 0, '6-10': 0, '11+': 0 };
  let clusters = 0, records = 0, books = 0;
  for (const g of groups) {
    if (g.n < 2) continue;
    clusters++; records += g.n; books += g.books;
    sizes[g.n === 2 ? 2 : g.n <= 5 ? '3-5' : g.n <= 10 ? '6-10' : '11+']++;
  }
  return { clusters, records, mentions_in_books: books, by_size: sizes };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('Missing MONGODB_URI.'); process.exit(2); }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, readPreference: 'secondaryPreferred' });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'bookstore');
    const cursor = db.collection('entities')
      .find({ type: 'person' }, { projection: { _id: 0, name: 1, aliases: 1, book_count: 1, merged_into: 1 } })
      .batchSize(5000);

    let total = 0, unjudgeable = 0, nonLatin = 0, withAliases = 0, alreadyMerged = 0;
    const byFold = new Map();   // fold key -> { n, books, words }
    const byLatin = new Map();  // latin key -> { n, books, words, folds:Set }
    const aliasKeys = [];       // [aliasFold, ownFold]
    for await (const doc of cursor) {
      total++;
      if (doc.merged_into) { alreadyMerged++; continue; }
      const k = nameKeys(doc.name);
      if (!k) { unjudgeable++; continue; }
      const books = doc.book_count || 0;
      const f = byFold.get(k.fold) ?? { n: 0, books: 0, words: k.words };
      f.n++; f.books += books; byFold.set(k.fold, f);
      if (k.latin === null) nonLatin++;
      else {
        const l = byLatin.get(k.latin) ?? { n: 0, books: 0, words: k.words, folds: new Set() };
        l.n++; l.books += books; l.folds.add(k.fold); byLatin.set(k.latin, l);
      }
      if (Array.isArray(doc.aliases) && doc.aliases.length) {
        withAliases++;
        for (const a of doc.aliases) { const ak = nameKeys(a); if (ak && ak.fold !== k.fold) aliasKeys.push([ak.fold, k.fold]); }
      }
    }

    const foldGroups = [...byFold.values()];
    // Latin-level clusters that the fold level did not already find: 2+ distinct folded names.
    const latinOnly = [...byLatin.values()].filter(g => g.folds.size >= 2);
    let aliasPairs = 0; const aliasTargets = new Set(); const aliasOwners = new Set();
    for (const [aliasFold, ownFold] of aliasKeys) {
      if (byFold.has(aliasFold)) { aliasPairs++; aliasTargets.add(aliasFold); aliasOwners.add(ownFold); }
    }

    const report = {
      measured_at: new Date().toISOString(),
      person_records: total,
      already_merged: alreadyMerged,
      unjudgeable_names: unjudgeable,
      non_latin_names_fold_level_only: nonLatin,
      records_with_aliases: withAliases,
      fold: { all: summarize(foldGroups), multi_word: summarize(foldGroups.filter(g => g.words > 1)) },
      latin_beyond_fold: { all: summarize(latinOnly), multi_word: summarize(latinOnly.filter(g => g.words > 1)) },
      alias_equals_another_records_name: { pairs: aliasPairs, records_named_by_an_alias: aliasTargets.size, records_owning_such_an_alias: aliasOwners.size },
    };
    if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      const line = (label, s) => console.log(`${label.padEnd(44)} ${String(s.clusters).padStart(7)} clusters  ${String(s.records).padStart(7)} records  sizes ${JSON.stringify(s.by_size)}`);
      console.log(`person records                               ${total}`);
      console.log(`  already merged (skipped)                   ${alreadyMerged}`);
      console.log(`  unjudgeable names (not compared)           ${unjudgeable}`);
      console.log(`  non-Latin names (fold level only)          ${nonLatin}`);
      console.log(`  records with aliases                       ${withAliases}`);
      line('same name after folding', report.fold.all);
      line('  of which names of 2+ words', report.fold.multi_word);
      line('same after Latin-case stripping (new)', report.latin_beyond_fold.all);
      line('  of which names of 2+ words', report.latin_beyond_fold.multi_word);
      console.log(`alias equals another record's name           ${aliasPairs} pairs; ${aliasTargets.size} records named by someone's alias; ${aliasOwners.size} records owning one`);
      console.log('\nCounts only. A collision is a candidate for a by-eye look, not a merge.');
    }
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
