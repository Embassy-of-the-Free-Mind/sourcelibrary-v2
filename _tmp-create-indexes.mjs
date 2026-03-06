#!/usr/bin/env node
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const indexes = [
  {
    collection: 'pages',
    fields: { book_id: 1, 'transliteration.data': 1 },
    options: { name: 'pages_book_transliteration_idx', background: true, sparse: true },
  },
  {
    collection: 'books',
    fields: { 'pipeline_auto.status': 1, 'pipeline_auto.last_updated': 1 },
    options: { name: 'books_pipeline_status_updated_idx', background: true, sparse: true },
  },
  {
    collection: 'entities',
    fields: { aliases: 1 },
    options: { name: 'entities_aliases_idx', background: true },
  },
];

for (const idx of indexes) {
  try {
    await db.collection(idx.collection).createIndex(idx.fields, idx.options);
    console.log(`OK: ${idx.collection}.${idx.options.name}`);
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('already exists')) {
      console.log(`EXISTS: ${idx.collection}.${idx.options.name}`);
    } else {
      console.log(`ERROR: ${idx.collection}.${idx.options.name}: ${msg}`);
    }
  }
}

await client.close();
