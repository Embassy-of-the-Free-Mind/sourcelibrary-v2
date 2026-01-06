#!/usr/bin/env node
/**
 * List all books in MongoDB with their USTC-related fields
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    });
  }
}
loadEnv();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;

if (!MONGODB_URI || !MONGODB_DB) {
  console.error('Missing MONGODB_URI or MONGODB_DB');
  process.exit(1);
}

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db(MONGODB_DB);

  const books = await db.collection('books').find({}).toArray();

  console.log(`Found ${books.length} books:\n`);

  books.forEach((book, i) => {
    console.log(`${i + 1}. ${book.title}`);
    console.log(`   Author: ${book.author}`);
    console.log(`   Published: ${book.published}`);
    console.log(`   USTC ID: ${book.ustc_id || '(none)'}`);
    console.log(`   Display Title: ${book.display_title || '(none)'}`);
    console.log(`   Place: ${book.place_published || '(none)'}`);
    console.log(`   Publisher: ${book.publisher || '(none)'}`);
    console.log(`   Format: ${book.format || '(none)'}`);
    console.log('');
  });

  await client.close();
}

main().catch(console.error);
