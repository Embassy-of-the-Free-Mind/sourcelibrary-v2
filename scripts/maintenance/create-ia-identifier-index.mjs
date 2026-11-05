/**
 * Create the `ia_identifier` index on `books` for /ia/<identifier> (#8161).
 *
 * PRIOR ART: scripts/maintenance/create-split-from-spread-index.mjs — same shape,
 * a different field and collection, so it cannot be reused as it stands.
 *
 * The field was unindexed, so the redirect's lookup would scan `books` on every
 * request. Sparse, because about 52K books carry it (measured 2026-11-05).
 * Idempotent, and the build does not block writes.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/create-ia-identifier-index.mjs
 */
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });

try {
  await client.connect();
  const books = client.db('bookstore').collection('books');
  const name = await books.createIndex({ ia_identifier: 1 }, { sparse: true, name: 'ia_identifier_1' });
  const indexes = await books.indexes();
  const found = indexes.find((i) => i.name === name);
  if (!found) throw new Error(`index ${name} not present after createIndex`);
  console.log('index ready:', JSON.stringify(found));

  // Prove the lookup the route makes actually uses it.
  const sample = await books.findOne(
    { ia_identifier: { $type: 'string', $ne: '' } },
    { projection: { _id: 0, ia_identifier: 1 } },
  );
  const plan = await books
    .find({ ia_identifier: sample.ia_identifier, visible: true, pages_count: { $gt: 0 } })
    .sort({ pages_translated: -1 })
    .limit(1)
    .explain('executionStats');
  const { totalDocsExamined, executionTimeMillis } = plan.executionStats;
  console.log('lookup examined', totalDocsExamined, 'docs in', executionTimeMillis, 'ms');
  if (totalDocsExamined > 10) throw new Error('lookup is not using the index');
} finally {
  await client.close();
}
