#!/usr/bin/env node
// PRIOR ART: scripts/enrichment/merge-qid-duplicates.mjs — same-name+QID duplicates only, and it
// deletes the losers. scripts/enrichment/dedup-entities.mjs — alias rows only, with a paid model.
// scripts/maintenance/repair-entity-page-attribution.mjs — repairs page claims, merges nothing.
/**
 * DRY RUN ONLY: show what merging a by-eye cluster of `entities` person records would write.
 *
 * "Drebbel" is split across twenty person records and the bare surname "Küffler" across seven
 * (#5888), so no one record carries the spellings a search needs or the full list of books.
 * This prints, per cluster in `person-entity-clusters-5888.json`:
 *   - the survivor (most books) with its merged aliases, books[] and recomputed counters;
 *   - each loser, kept as a redirect (`merged_into`), never deleted;
 *   - the `entity_aliases` rows that make the index writers route future mentions to the
 *     survivor — without them the next index run recreates every loser.
 *
 * There is NO apply mode. The plan goes on the issue for review first; applying it is a bulk
 * write to `entities`, which must not coincide with a production build (CLAUDE.md, and
 * scripts/audit/entities-sweep-active.mjs must report clear before any merge to main).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/merge-person-entity-clusters.mjs
 *     [--cluster drebbel]   one cluster only
 *     [--json plan.json]    also write the full plan (every loser's books[], for undo)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { MongoClient, ObjectId } from 'mongodb';
import { planClusterMerge } from '../lib/entity-merge-plan.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : null; };
if (args.includes('--apply')) {
  console.error('There is no --apply. This script only prints the plan (#5888).');
  process.exit(2);
}

const { clusters } = JSON.parse(readFileSync(new URL('./person-entity-clusters-5888.json', import.meta.url), 'utf8'));
const only = flag('--cluster');
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('Missing MONGODB_URI.'); process.exit(2); }

const toId = (s) => (ObjectId.isValid(s) ? new ObjectId(s) : s);
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
const plans = [];
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  for (const cluster of clusters) {
    if (only && cluster.key !== only) continue;
    // `_id` is an ObjectId on most rows and a string on some; ask for both.
    const docs = await db.collection('entities')
      .find({ _id: { $in: cluster.members.flatMap(id => [toId(id), id]) } })
      .toArray();
    const missing = cluster.members.filter(id => !docs.some(d => String(d._id) === id));
    const names = docs.flatMap(d => [d.name, ...(d.aliases || [])]).filter(n => typeof n === 'string').map(n => n.toLowerCase());
    const aliasRows = await db.collection('entity_aliases')
      .find({ type: 'person', alias_lower: { $in: [...new Set(names)] } })
      .project({ _id: 0, alias_lower: 1, canonical_name: 1 })
      .toArray();
    const plan = planClusterMerge(docs, { aliasRows });
    plans.push({ key: cluster.key, person: cluster.person, missing, exclude: cluster.exclude || [], ...plan });

    const s = plan.survivor;
    console.log(`\n## ${cluster.key} — ${cluster.person}`);
    if (missing.length) console.log(`!! ${missing.length} listed record(s) not found: ${missing.join(', ')}`);
    console.log(`SURVIVOR  ${s.name}  (${s._id})`);
    console.log(`  books    ${s.before.book_count} -> ${s.set.book_count}  (+${s.booksGained})`);
    console.log(`  mentions (verified pages) -> ${s.set.total_mentions}`);
    console.log(`  aliases  ${s.before.aliases} -> ${s.set.aliases.length}: ${s.set.aliases.join(' | ')}`);
    for (const [field, f] of Object.entries(s.filled)) console.log(`  fills    ${field} from "${f.from}"`);
    console.log(`LOSERS  (${plan.losers.length}; each kept, books[] emptied, merged_into = survivor)`);
    for (const l of plan.losers) console.log(`  - ${l.name.padEnd(30)} ${String(l.books).padStart(3)} book(s), ${l.booksNewToSurvivor} new to the survivor  (${l._id})`);
    console.log(`entity_aliases: ${plan.aliasRows.length} new row(s) -> "${s.name}"`);
    for (const c of plan.aliasConflicts) console.log(`  !! "${c.alias_lower}" already points to "${c.existing}" — left alone`);
    for (const e of cluster.exclude || []) console.log(`NOT MERGED  ${e.name} (${e._id}): ${e.why}`);
  }
} finally {
  await client.close();
}

const out = flag('--json');
if (out) { writeFileSync(out, JSON.stringify(plans, null, 2)); console.log(`\nfull plan written to ${out}`); }
console.log('\nDRY RUN — nothing was written.');
