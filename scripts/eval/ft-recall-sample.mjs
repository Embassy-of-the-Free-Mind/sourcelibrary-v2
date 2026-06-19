#!/usr/bin/env node
/**
 * Draw a random sample from the NOT-badged first-translation-eligible pool
 * (issue #2564 / #1974 recall question). These are translated, non-English
 * books that were never assessed for first-translation status. Sampling them
 * and Tier-2-adjudicating estimates how many GENUINE firsts we never badged —
 * the recall side, complementary to the precision estimate on badged firsts.
 *
 * Read-only; writes a worklist for the Tier-2 workflow generator.
 * Usage: set -a; source .env.production.local; set +a; node scripts/eval/ft-recall-sample.mjs [--n=40]
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';

const N = parseInt(process.argv.find((a) => a.startsWith('--n='))?.split('=')[1] || '40', 10);

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const b = c.db('bookstore').collection('books');

const pool = await b.find(
  { visible: true, pages_translated: { $gt: 0 }, language: { $ne: 'English', $exists: true }, is_first_translation: { $ne: true } },
  { projection: { id: 1, author: 1, title: 1, language: 1, pages_count: 1, pages_translated: 1, 'translation_verification.disposition': 1 } },
).toArray();

// $sample is cleaner but we want reproducibility — seeded Fisher-Yates.
let s = 424242;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const sample = pool.slice(0, N);

const worklist = sample.map((x) => ({
  id: x.id || String(x._id), a: (x.author || '').slice(0, 40), t: (x.title || '').slice(0, 70),
  l: x.language || '', s: 'recall/notbadged/' + (x.translation_verification?.disposition || 'none'),
}));
writeFileSync('scripts/eval/results/ft-recall-worklist.json', JSON.stringify(worklist));

const langs = {};
for (const x of sample) langs[x.language] = (langs[x.language] || 0) + 1;
console.error(`pool size (not-badged eligible): ${pool.length}`);
console.error(`drawn sample: ${sample.length}`);
console.error('sample by language:', JSON.stringify(langs));
console.error('disposition in pool sample:', JSON.stringify(sample.reduce((m, x) => { const d = x.translation_verification?.disposition || 'none'; m[d] = (m[d] || 0) + 1; return m; }, {})));
console.error('worklist written: scripts/eval/results/ft-recall-worklist.json');
await c.close();
