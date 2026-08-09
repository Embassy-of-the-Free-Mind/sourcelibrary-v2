#!/usr/bin/env node
/**
 * CLI for the USTC author-coverage metric — see scripts/lib/ustc-author-coverage.mjs
 * for what the tiers mean (exact = floor, cluster = estimate; truth between).
 *
 * Prints the current numbers and, with --save, upserts them to
 * catalog_coverage_meta {_id: 'author_coverage'} so ad-hoc readers don't have
 * to re-run the 2.4M-row aggregation. The nightly snapshot-stats.mjs records
 * the same numbers into catalog_coverage_snapshots as a tracked series.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/catalog-coverage/ustc-author-coverage.mjs
 *   node --env-file=.env.production.local scripts/catalog-coverage/ustc-author-coverage.mjs --save
 */
import { MongoClient } from 'mongodb';
import { computeUstcAuthorCoverage } from '../lib/ustc-author-coverage.mjs';

const SAVE = process.argv.includes('--save');

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');

const t0 = Date.now();
const c = await computeUstcAuthorCoverage(db);
console.log(`USTC-derived census: ${c.census_distinct_authors.toLocaleString()} distinct authors over ${c.census_authored_editions.toLocaleString()} authored editions`);
console.log(`Our name forms (thesaurus variants + book author strings): ${c.our_name_forms.toLocaleString()}`);
console.log(`\nAuthors we hold >=1 book by:`);
console.log(`  exact tier (floor):     ${c.matched_exact.toLocaleString()}  (${c.pct_authors_exact}% of authors, ${c.pct_editions_exact}% of authored editions)`);
console.log(`  cluster tier (estimate): ${c.matched_cluster.toLocaleString()}  (${c.pct_authors_cluster}% of authors, ${c.pct_editions_cluster}% of authored editions)`);
console.log(`\ncomputed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

if (SAVE) {
  await db.collection('catalog_coverage_meta').updateOne(
    { _id: 'author_coverage' },
    { $set: { ...c, computed_at: new Date() } },
    { upsert: true },
  );
  console.log(`saved -> catalog_coverage_meta {_id: 'author_coverage'}`);
}
await mc.close();
