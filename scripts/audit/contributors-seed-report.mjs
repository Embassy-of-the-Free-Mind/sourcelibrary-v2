#!/usr/bin/env node
/**
 * Report-only seed for `books.contributors[]` (#7787 steps 1-2). WRITES NOTHING.
 *
 * PRIOR ART: scripts/audit/thesaurus-variant-shape.mjs — classifies the shape of
 * `authors.variants[]` strings; this applies the same classifier to
 * `books.author` and asks the next question: could each part be attached to a
 * thesaurus person, and in what role? The proposal logic is
 * `proposeContributors` in scripts/lib/contributors.mjs, shared with the writer.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/contributors-seed-report.mjs [--all]
 *   --all  every text book, not just live ones (visible && pages_count > 0)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { bookYear, loadAuthorIndex, proposeContributors, POLLUTED_SLUG } from '../lib/contributors.mjs';

const ALL = process.argv.includes('--all');
const OUT = 'scripts/output/contributors-seed-report.json';
const SAMPLES = 25;

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const scope = ALL
  ? { content_type: { $ne: 'artwork' } }
  : { visible: true, pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' } };

const index = await loadAuthorIndex(db);

const buckets = {};
const add = (b, row) => {
  buckets[b] ??= { books: 0, strings: new Map() };
  buckets[b].books++;
  const e = buckets[b].strings.get(row.author);
  if (e) e.books++; else buckets[b].strings.set(row.author, { ...row, books: 1 });
};
const roles = {};
let total = 0; let authorIdAgrees = 0; let authorIdDisagrees = 0;
const disagreeSamples = [];
const pollutedSlugs = new Map();

for await (const b of db.collection('books').find({ ...scope, author: { $type: 'string', $nin: ['', null] } },
  { projection: { author: 1, author_id: 1, published: 1, year: 1, date: 1 } }).batchSize(2000)) {
  total++;
  if (b.author_id && POLLUTED_SLUG.test(b.author_id)) pollutedSlugs.set(b.author_id, (pollutedSlugs.get(b.author_id) || 0) + 1);
  const { bucket, shape, proposed } = proposeContributors(b.author, b.author_id, index, bookYear(b.published ?? b.year ?? b.date));
  if (bucket === 'single_clean') { add(bucket, { author: b.author }); continue; }
  if (bucket === 'left_alone') { add(bucket, { author: b.author, shape }); continue; }
  for (const p of proposed) roles[p.role] = (roles[p.role] || 0) + 1;
  // A write keeps author_id as the primary author, so a resolved list that
  // does not name the current author_id means the two name different people.
  if (b.author_id && proposed.some((p) => p.author_id)) {
    if (proposed.some((p) => p.author_id === b.author_id)) authorIdAgrees++;
    else { authorIdDisagrees++; if (disagreeSamples.length < SAMPLES) disagreeSamples.push({ author: b.author, author_id: b.author_id, proposed }); }
  }
  add(bucket, { author: b.author, author_id: b.author_id ?? null, proposed });
}
await mc.close();

const report = {
  generated_at: new Date().toISOString(),
  scope: ALL ? 'all text books' : 'live text books (visible, pages_count > 0)',
  thesaurus_docs: index.docs,
  books_with_author: total,
  roles_proposed: roles,
  author_id_vs_proposal: { agrees: authorIdAgrees, disagrees: authorIdDisagrees, samples: disagreeSamples },
  role_polluted_author_ids: {
    slugs: pollutedSlugs.size,
    books: [...pollutedSlugs.values()].reduce((a, n) => a + n, 0),
    top: [...pollutedSlugs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40),
  },
  buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => {
    const strings = [...v.strings.values()].sort((a, b) => b.books - a.books);
    return [k, { books: v.books, distinct_strings: strings.length, top: strings.slice(0, SAMPLES) }];
  })),
};
mkdirSync('scripts/output', { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`${report.scope}: ${total} books with an author string; ${index.docs} thesaurus docs`);
for (const [k, v] of Object.entries(report.buckets)) console.log(`  ${k.padEnd(22)} ${String(v.books).padStart(6)} books  ${v.distinct_strings} strings`);
console.log('roles proposed:', JSON.stringify(roles));
console.log(`author_id among resolved parts: ${authorIdAgrees} agree, ${authorIdDisagrees} disagree`);
console.log(`author_id slugs that look role-polluted: ${report.role_polluted_author_ids.slugs} (${report.role_polluted_author_ids.books} books)`);
console.log(`report: ${OUT}`);
