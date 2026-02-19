import { MongoClient } from 'mongodb';
import fs from 'fs';
const env = {};
try { const c = fs.readFileSync('.env.local','utf8'); for (const l of c.split('\n')) { const m = l.match(/^([^=#]+)=(.*)$/); if(m) { let v=m[2].trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); env[m[1].trim()]=v; } } } catch {}
const URI = process.env.MONGODB_URI || env.MONGODB_URI;
const c2 = new MongoClient(URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
await c2.connect();
const db = c2.db('bookstore');

// Geneva Bible
const page = await db.collection('pages')
  .findOne({ book_id: '6992468abc722ec0ee80e04f' }, { projection: { page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1 } });

console.log('Geneva Bible page 1:');
console.log('  cropped_photo:', page?.cropped_photo || 'null');
console.log('  archived_photo:', page?.archived_photo || 'null');
console.log('  photo:', page?.photo || 'null');
console.log('  photo_original:', page?.photo_original || 'null');

// Try fetching photo_original
const url = page?.photo_original || page?.photo;
if (url) {
  try {
    const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    console.log(`  fetch status: ${resp.status}`);
  } catch (e) {
    console.log(`  fetch error: ${e.message}`);
  }
}

await c2.close();
