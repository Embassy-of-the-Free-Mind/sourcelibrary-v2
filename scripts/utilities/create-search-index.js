/**
 * Creates a text index on the pages collection for search functionality.
 *
 * Run with: node scripts/create-search-index.js
 *
 * Or run directly in MongoDB shell:
 * db.pages.createIndex({ "ocr.data": "text", "translation.data": "text" }, { name: "page_text_search" })
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Load .env.local manually
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key] = valueParts.join('=').replace(/^["']|["']$/g, '');
      }
    }
  }
}

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
    // Use "none" as default_language to disable stemming (Latin isn't supported)
    // Use language_override to prevent MongoDB from using the document's "language" field
    const result = await collection.createIndex(
      { 'ocr.data': 'text', 'translation.data': 'text' },
      { name: 'page_text_search', default_language: 'none', language_override: 'none' }
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
