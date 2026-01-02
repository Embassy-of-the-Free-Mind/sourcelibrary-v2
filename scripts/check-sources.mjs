import { config } from 'dotenv';
config({ path: '.env.local' });

import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

function categorizeUrl(url) {
  if (!url) return null;
  if (url.includes('archive.org')) return 'archive.org';
  if (url.includes('digi.vatlib')) return 'Vatican';
  if (url.includes('bodleian') || url.includes('digital.bodleian')) return 'Bodleian';
  if (url.includes('gallica')) return 'Gallica';
  if (url.includes('vercel') || url.includes('blob')) return 'Vercel Blob';
  if (url.includes('s3.amazonaws')) return 'S3';
  if (url.includes('iiif')) return 'IIIF (other)';
  if (url.startsWith('/') || url.startsWith('.')) return 'Local file';
  try {
    return 'Other: ' + new URL(url).hostname;
  } catch (e) {
    return 'Other';
  }
}

// Count total pages needing OCR
const totalNeedingOcr = await db.collection('pages').countDocuments({
  $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }]
});
console.log(`Total pages needing OCR: ${totalNeedingOcr}`);

// Count pages that have accessible images (cropped_photo or archived_photo or non-IA photo)
const accessibleCount = await db.collection('pages').countDocuments({
  $and: [
    { $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] },
    { $or: [
      { cropped_photo: { $exists: true, $ne: null } },
      { archived_photo: { $exists: true, $ne: null } },
      { photo: { $exists: true, $ne: null, $not: { $regex: 'archive\\.org' } } }
    ]}
  ]
});
console.log(`\nPages needing OCR with accessible images: ${accessibleCount}`);

// Get details on image sources
const pages = await db.collection('pages').find({
  $and: [
    { $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] },
    { $or: [
      { cropped_photo: { $exists: true, $ne: null } },
      { archived_photo: { $exists: true, $ne: null } },
      { photo: { $exists: true, $ne: null } }
    ]}
  ]
}).project({ photo: 1, archived_photo: 1, cropped_photo: 1 }).toArray();

const sources = {};
for (const p of pages) {
  // Use best available image
  const url = p.cropped_photo || p.archived_photo || p.photo || '';
  const source = categorizeUrl(url) || 'None';
  sources[source] = (sources[source] || 0) + 1;
}

console.log(`\nAll pages needing OCR by best-available image source:`);
Object.entries(sources).sort((a,b) => b[1] - a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

// Also show just the S3/non-IA accessible images
const s3Count = sources['S3'] || 0;
const vbCount = sources['Vercel Blob'] || 0;
const localCount = sources['Local file'] || 0;
const otherAccessible = Object.entries(sources)
  .filter(([k]) => !['archive.org', 'Local file', 'None'].includes(k))
  .reduce((sum, [,v]) => sum + v, 0);

console.log(`\nAccessible now (not archive.org):`);
console.log(`  Total: ${otherAccessible}`);

await client.close();
