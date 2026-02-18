import { MongoClient } from 'mongodb';
import fs from 'fs';
const env = {};
try { const c = fs.readFileSync('.env.local','utf8'); for (const l of c.split('\n')) { const m = l.match(/^([^=#]+)=(.*)$/); if(m) { let v=m[2].trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); env[m[1].trim()]=v; } } } catch {}
const URI = process.env.MONGODB_URI || env.MONGODB_URI;
const client = new MongoClient(URI);
await client.connect();
const db = client.db('bookstore');

// Count unenriched books
const unenriched = await db.collection('books').countDocuments({ 'ai_metadata.enriched_at': { $exists: false } });

// Count unenriched books that have at least some OCR
const withOcr = await db.collection('books').aggregate([
  { $match: { 'ai_metadata.enriched_at': { $exists: false } } },
  { $lookup: { from: 'pages', localField: 'id', foreignField: 'book_id', as: 'p', pipeline: [
    { $match: { 'ocr.data': { $exists: true, $ne: '' } } },
    { $limit: 1 }
  ]}},
  { $match: { 'p.0': { $exists: true } } },
  { $count: 'total' }
]).toArray();

// Count unenriched books WITHOUT any OCR
const withoutOcr = await db.collection('books').aggregate([
  { $match: { 'ai_metadata.enriched_at': { $exists: false } } },
  { $lookup: { from: 'pages', localField: 'id', foreignField: 'book_id', as: 'p', pipeline: [
    { $match: { 'ocr.data': { $exists: true, $ne: '' } } },
    { $limit: 1 }
  ]}},
  { $match: { 'p.0': { $exists: false } } },
  { $count: 'total' }
]).toArray();

// Also check: how many enriched books have summaries, indexes?
const enrichedTotal = await db.collection('books').countDocuments({ 'ai_metadata.enriched_at': { $exists: true } });
const withSummary = await db.collection('books').countDocuments({ 'reading_summary.generated_at': { $exists: true } });
const withIndex = await db.collection('books').countDocuments({ 'index.generatedAt': { $exists: true } });
const withToc = await db.collection('books').countDocuments({ 'table_of_contents': { $exists: true } });
const withToc2 = await db.collection('books').countDocuments({ 'toc': { $exists: true } });

console.log('Unenriched books:', unenriched);
console.log('  With OCR text:', withOcr[0]?.total || 0);
console.log('  Without OCR:', withoutOcr[0]?.total || 0);
console.log('');
console.log('Enriched books:', enrichedTotal);
console.log('With summary:', withSummary);
console.log('With index:', withIndex);
console.log('With table_of_contents:', withToc);
console.log('With toc:', withToc2);

await client.close();
