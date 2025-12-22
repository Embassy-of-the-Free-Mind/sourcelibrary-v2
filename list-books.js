const { MongoClient } = require('mongodb');
const fs = require('fs');

// Read .env.local
const envContent = fs.readFileSync('.env.local', 'utf8');
const mongoLine = envContent.split('\n').find(l => l.startsWith('MONGODB_URI='));
const mongoUri = mongoLine.split('=').slice(1).join('=');

async function listBooks() {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db();
  
  const books = await db.collection('books').find({}).project({
    id: 1,
    title: 1,
    display_title: 1,
    author: 1,
    pages_count: 1
  }).toArray();
  
  console.log('Books in database (' + books.length + '):');
  console.log('---');
  books.forEach((b, i) => {
    console.log((i+1) + '. ' + (b.display_title || b.title));
    console.log('   ID: ' + b.id);
    console.log('   Author: ' + (b.author || 'Unknown'));
    console.log('   Pages: ' + (b.pages_count || 'N/A'));
    console.log('');
  });
  
  await client.close();
}

listBooks().catch(console.error);
