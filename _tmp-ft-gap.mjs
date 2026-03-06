import { MongoClient } from 'mongodb';

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');

// Check recent books: why no ai_metadata.first_translation?
const recentNoAI = await db.collection('books').find({
  language: { $nin: ['English', 'english', null, ''] },
  pages_translated: { $gt: 0 },
  'ai_metadata.first_translation': { $exists: false },
}, { projection: { title: 1, language: 1, pipeline_auto: 1, created_at: 1, pages_translated: 1, ai_metadata: 1 } })
.sort({ created_at: -1 }).limit(10).toArray();

console.log('=== Recent non-English translated books WITHOUT ai_metadata.first_translation ===');
for (const b of recentNoAI) {
  const hasAI = b.ai_metadata ? 'has_ai_metadata' : 'no_ai_metadata';
  console.log(`  ${b.title?.substring(0,50)} | lang=${b.language} | pipeline=${b.pipeline_auto?.status || 'none'} | translated=${b.pages_translated} | ${hasAI} | created=${b.created_at?.toISOString?.()?.substring(0,10)}`);
}

// Pipeline status distribution for books missing first_translation
const pipelineStatuses = await db.collection('books').aggregate([
  { $match: { language: { $nin: ['English', 'english', null, ''] }, pages_translated: { $gt: 0 }, 'ai_metadata.first_translation': { $exists: false } } },
  { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).toArray();
console.log('\n=== Pipeline status of books missing first_translation ===');
for (const s of pipelineStatuses) console.log(`  ${s._id || 'no pipeline'}: ${s.count}`);

// Have ai_metadata at all but no first_translation?
const hasAInoFT = await db.collection('books').countDocuments({
  language: { $nin: ['English', 'english', null, ''] },
  pages_translated: { $gt: 0 },
  ai_metadata: { $exists: true },
  'ai_metadata.first_translation': { $exists: false }
});
console.log(`\nHave ai_metadata but no first_translation: ${hasAInoFT}`);

// Pipeline complete but no first_translation?
const completeNoFT = await db.collection('books').countDocuments({
  language: { $nin: ['English', 'english', null, ''] },
  pages_translated: { $gt: 0 },
  'pipeline_auto.status': 'complete',
  'ai_metadata.first_translation': { $exists: false }
});
console.log(`Pipeline complete but no first_translation: ${completeNoFT}`);

// Totals
const flagged = await db.collection('books').countDocuments({ is_first_translation: true });
const totalTranslatedNonEng = await db.collection('books').countDocuments({
  language: { $nin: ['English', 'english', null, ''] },
  pages_translated: { $gt: 0 }
});
console.log(`\nis_first_translation=true: ${flagged}`);
console.log(`Total translated non-English: ${totalTranslatedNonEng}`);

// Verification coverage
const verified = await db.collection('books').countDocuments({ 'translation_verification': { $exists: true } });
const verifiedDispositions = await db.collection('books').aggregate([
  { $match: { 'translation_verification': { $exists: true } } },
  { $group: { _id: '$translation_verification.disposition', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).toArray();
console.log(`\nTotal with translation_verification: ${verified}`);
for (const d of verifiedDispositions) console.log(`  ${d._id}: ${d.count}`);

// Books with ai_metadata that passed enrichment but no first_translation field
const enrichedNoFT = await db.collection('books').countDocuments({
  language: { $nin: ['English', 'english', null, ''] },
  pages_translated: { $gt: 0 },
  ai_metadata: { $exists: true },
  'ai_metadata.first_translation': { $exists: false },
  'pipeline_auto.status': { $in: ['metadata_enriched', 'translate_submitted', 'translate_complete', 'enriching', 'enriched', 'chapters', 'chapters_complete', 'images_submitted', 'images_complete', 'complete'] }
});
console.log(`\nPassed metadata_enriched but no first_translation: ${enrichedNoFT}`);

// When was enrichment added? Check earliest ai_metadata.first_translation
const earliest = await db.collection('books').find({
  'ai_metadata.first_translation': { $exists: true }
}).sort({ 'ai_metadata.enriched_at': 1 }).limit(1).project({ title: 1, 'ai_metadata.enriched_at': 1 }).toArray();
console.log(`\nEarliest ai_metadata with first_translation: ${JSON.stringify(earliest)}`);

// How many non-English books have NO ai_metadata at all?
const noAIatAll = await db.collection('books').countDocuments({
  language: { $nin: ['English', 'english', null, ''] },
  pages_translated: { $gt: 0 },
  ai_metadata: { $exists: false }
});
console.log(`No ai_metadata at all (translated, non-English): ${noAIatAll}`);

await client.close();
