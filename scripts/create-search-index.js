/**
 * Creates a text index on the pages collection for search functionality.
 *
 * Run with: node scripts/create-search-index.js
 *
 * Or run directly in MongoDB shell:
 * db.pages.createIndex({ "ocr.data": "text", "translation.data": "text" }, { name: "page_text_search" })
 */

const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function createSearchIndex() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;

  if (!uri || !dbName) {
    console.error('Missing MONGODB_URI or MONGODB_DB in .env.local');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(dbName);
    const collection = db.collection('pages');

    // Check if index already exists
    const indexes = await collection.indexes();
    const existingIndex = indexes.find(idx => idx.name === 'page_text_search');

    if (existingIndex) {
      console.log('Text index already exists:', existingIndex);
      return;
    }

    // Create the text index
    const result = await collection.createIndex(
      { 'ocr.data': 'text', 'translation.data': 'text' },
      { name: 'page_text_search' }
    );

    console.log('Text index created:', result);
  } catch (error) {
    console.error('Error creating index:', error);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

createSearchIndex();
