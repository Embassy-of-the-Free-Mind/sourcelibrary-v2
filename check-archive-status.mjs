import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.prod' });
config({ path: '.env.local', override: true });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

// Count pages with archived photos
const archivedCount = await db.collection('pages').countDocuments({
  archived_photo: { $exists: true, $ne: null, $ne: '' }
});
const totalPages = await db.collection('pages').countDocuments();

console.log('Vercel Blob Archive Status:');
console.log(`  Archived pages: ${archivedCount.toLocaleString()}`);
console.log(`  Total pages: ${totalPages.toLocaleString()}`);
console.log(`  Coverage: ${((archivedCount / totalPages) * 100).toFixed(1)}%`);

// Check for IIIF pages still needing archive
const iiifNeedingArchive = await db.collection('pages').countDocuments({
  photo: { $regex: 'digi.vatlib|gallica|bodleian|digital.bodleian|digitale-sammlungen|iiif', $options: 'i' },
  $or: [
    { archived_photo: { $exists: false } },
    { archived_photo: null },
    { archived_photo: '' }
  ]
});

console.log(`\nIIIF pages still needing archive: ${iiifNeedingArchive.toLocaleString()}`);

// Sample of recently archived
const recent = await db.collection('pages')
  .find({ archived_photo: { $exists: true, $ne: null } })
  .sort({ _id: -1 })
  .limit(1)
  .project({ archived_photo: 1, photo: 1 })
  .toArray();

if (recent.length > 0) {
  console.log(`\nMost recent archived: ${recent[0].archived_photo?.substring(0, 80)}...`);
}

await client.close();
