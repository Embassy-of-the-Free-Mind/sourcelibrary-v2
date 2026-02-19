#!/usr/bin/env node
/**
 * Collect comprehensive stats for postmortem report.
 * Run: node scripts/collect-postmortem-stats.mjs
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

function loadEnv() {
  const env = {};
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=#]+)=(.*)$/);
      if (match) {
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        env[match[1].trim()] = value;
      }
    }
  } catch { /* no .env.local */ }
  return { ...process.env, ...env };
}

const env = loadEnv();
const client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 3, serverSelectionTimeoutMS: 10000 });

async function main() {
  await client.connect();
  const db = client.db(env.MONGODB_DB || 'bookstore');

  console.log('=== COLLECTION OVERVIEW ===');
  const totalBooks = await db.collection('books').countDocuments({});
  const totalPages = await db.collection('pages').countDocuments({});
  const pagesWithOcr = await db.collection('pages').countDocuments({ 'ocr.data': { $exists: true, $ne: '' } });
  const pagesWithTranslation = await db.collection('pages').countDocuments({ 'translation.data': { $exists: true, $ne: '' } });
  console.log('Total books:', totalBooks);
  console.log('Total pages:', totalPages);
  console.log('Pages with OCR:', pagesWithOcr);
  console.log('Pages with translation:', pagesWithTranslation);

  console.log('\n=== METADATA QUALITY DISTRIBUTION ===');
  const qualityDist = await db.collection('books').aggregate([
    { $group: { _id: '$metadata_quality', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  qualityDist.forEach(v => console.log(' ', v._id || '(null)', ':', v.count));

  console.log('\n=== OCR PROMPT VERSION DISTRIBUTION ===');
  const versionDist = await db.collection('pages').aggregate([
    { $match: { 'ocr.data': { $exists: true, $ne: '' } } },
    { $group: { _id: '$ocr.prompt_version', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  versionDist.forEach(v => console.log(' ', v._id || '(null/missing)', ':', v.count));

  console.log('\n=== CHAPTER EXTRACTION ===');
  const chaptered = await db.collection('books').countDocuments({ chapters_extracted_at: { $exists: true } });
  const withChapterData = await db.collection('books').countDocuments({ 'chapters.0': { $exists: true } });
  console.log('Books processed:', chaptered);
  console.log('Books with 1+ chapters:', withChapterData);

  console.log('\n=== CATALOG ENRICHMENT ===');
  const withBph = await db.collection('books').countDocuments({ 'catalog_matches.bph': { $exists: true } });
  const withUstc = await db.collection('books').countDocuments({ 'catalog_matches.ustc': { $exists: true } });
  const withFirstTrans = await db.collection('books').countDocuments({ first_translation: { $exists: true } });
  console.log('BPH matches:', withBph);
  console.log('USTC matches:', withUstc);
  console.log('first_translation set:', withFirstTrans);

  console.log('\n=== AI METADATA ENRICHMENT ===');
  const withAiMeta = await db.collection('books').countDocuments({ 'ai_metadata.enriched_at': { $exists: true } });
  const withCategories = await db.collection('books').countDocuments({ 'categories.0': { $exists: true } });
  const withSummary = await db.collection('books').countDocuments({ 'reading_summary.overview': { $exists: true } });
  const withIndex = await db.collection('books').countDocuments({ 'index.generatedAt': { $exists: true } });
  console.log('Books with ai_metadata:', withAiMeta);
  console.log('Books with categories:', withCategories);
  console.log('Books with reading_summary:', withSummary);
  console.log('Books with index:', withIndex);

  console.log('\n=== IMAGE EXTRACTION ===');
  const pagesWithImages = await db.collection('pages').countDocuments({ 'detected_images.0': { $exists: true } });
  const withGallery = await db.collection('books').countDocuments({ gallery_image_count: { $gte: 1 } });
  console.log('Pages with detected_images:', pagesWithImages);
  console.log('Books with gallery images:', withGallery);

  console.log('\n=== PROVIDER DISTRIBUTION ===');
  const providerDist = await db.collection('books').aggregate([
    { $group: { _id: '$provider', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  providerDist.forEach(v => console.log(' ', v._id || '(null)', ':', v.count));

  console.log('\n=== LANGUAGE DISTRIBUTION (top 15) ===');
  const langDist = await db.collection('books').aggregate([
    { $group: { _id: '$language', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 15 }
  ]).toArray();
  langDist.forEach(v => console.log(' ', v._id || '(null)', ':', v.count));

  console.log('\n=== GEMINI USAGE (ALL TIME) ===');
  const costByType = await db.collection('gemini_usage').aggregate([
    { $group: { _id: '$type', count: { $sum: 1 }, totalCost: { $sum: '$cost_usd' } } },
    { $sort: { totalCost: -1 } }
  ]).toArray();
  let grandTotal = 0;
  costByType.forEach(v => {
    grandTotal += v.totalCost || 0;
    console.log(' ', v._id, ':', v.count, 'calls, $' + (v.totalCost || 0).toFixed(2));
  });
  console.log('  TOTAL: $' + grandTotal.toFixed(2));

  console.log('\n=== RECENT COSTS (last 7 days) ===');
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentCosts = await db.collection('gemini_usage').aggregate([
    { $match: { timestamp: { $gte: sevenDaysAgo } } },
    { $group: { _id: '$type', count: { $sum: 1 }, totalCost: { $sum: '$cost_usd' } } },
    { $sort: { totalCost: -1 } }
  ]).toArray();
  let recentTotal = 0;
  recentCosts.forEach(v => {
    recentTotal += v.totalCost || 0;
    console.log(' ', v._id, ':', v.count, 'calls, $' + (v.totalCost || 0).toFixed(2));
  });
  console.log('  TOTAL (7d): $' + recentTotal.toFixed(2));

  console.log('\n=== BOOKS WITH 0 PAGES ===');
  const zeroPages = await db.collection('books').countDocuments({ pages_count: { $lte: 0 } });
  console.log('pages_count <= 0:', zeroPages);

  console.log('\n=== ARCHIVING STATUS ===');
  const archivedPages = await db.collection('pages').countDocuments({ archived_photo: { $exists: true } });
  console.log('Pages archived:', archivedPages, '/', totalPages);

  await client.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
