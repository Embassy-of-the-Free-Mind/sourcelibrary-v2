/**
 * Fix data quality issues:
 * 1. Fix Voynich manuscript image URLs
 * 2. Fix "lat" -> "Latin" language
 * 3. Normalize categories (merge Title Case into lowercase IDs)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { MongoClient } from 'mongodb';

const CATEGORY_MAPPING = {
  // Title Case -> lowercase ID
  'Alchemy': 'alchemy',
  'Hermeticism': 'hermeticism',
  'Neoplatonism': 'neoplatonism',
  'Natural Philosophy': 'natural-philosophy',
  'Astrology': 'astrology',
  'Rosicrucianism': 'rosicrucianism',
  'Mysticism': 'mysticism',
  'Theology': 'theology',
  'Medicine': 'medicine',
  'Freemasonry': 'freemasonry',
  'Theurgy': 'theurgy',
  'Gnosticism': 'gnosticism',
  'Theosophy': 'theosophy',
  'Divination': 'divination',
  // Common variants
  'Jewish Kabbalah': 'jewish-kabbalah',
  'Kabbalah': 'jewish-kabbalah',
  'Christian Cabala': 'christian-cabala',
  'Christian Mysticism': 'christian-mysticism',
  'Florentine Platonism': 'florentine-platonism',
  'Renaissance': 'renaissance',
  'Reformation Era': 'reformation',
  'Enlightenment': 'enlightenment',
  'Natural Magic': 'natural-magic',
  'Ritual Magic': 'ritual-magic',
  'Ars Notoria': 'ars-notoria',
  'Prisca Theologia': 'prisca-theologia',
  '19th Century Revival': '19th-century-revival',
};

async function fixDataQuality() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  console.log('=== Data Quality Fixes ===\n');

  // 1. Fix Voynich manuscript image URLs
  console.log('1. Fixing Voynich manuscript image URLs...');
  const voynichBook = await db.collection('books').findOne({ ia_identifier: 'voynich' });

  if (voynichBook) {
    const voynichPages = await db.collection('pages')
      .find({ book_id: voynichBook.id })
      .sort({ page_number: 1 })
      .toArray();

    console.log(`   Found ${voynichPages.length} Voynich pages to fix`);

    let fixed = 0;
    for (const page of voynichPages) {
      // Voynich uses 001.jpg, 002.jpg format
      const pageNum = String(page.page_number).padStart(3, '0');
      const newPhoto = `https://archive.org/download/voynich/${pageNum}.jpg`;
      const newThumb = `https://archive.org/download/voynich/${pageNum}_thumb.jpg`;

      await db.collection('pages').updateOne(
        { id: page.id },
        {
          $set: {
            photo: newPhoto,
            photo_original: newPhoto,
            thumbnail: newThumb,
            updated_at: new Date()
          }
        }
      );
      fixed++;
    }

    // Also fix the book thumbnail
    await db.collection('books').updateOne(
      { id: voynichBook.id },
      {
        $set: {
          thumbnail: 'https://archive.org/download/voynich/001_thumb.jpg',
          updated_at: new Date()
        }
      }
    );

    console.log(`   Fixed ${fixed} Voynich page URLs\n`);
  } else {
    console.log('   Voynich book not found\n');
  }

  // 2. Fix "lat" -> "Latin"
  console.log('2. Fixing "lat" -> "Latin"...');
  const latResult = await db.collection('books').updateMany(
    { language: 'lat' },
    { $set: { language: 'Latin', updated_at: new Date() } }
  );
  console.log(`   Fixed ${latResult.modifiedCount} books\n`);

  // 3. Normalize categories
  console.log('3. Normalizing categories...');
  const booksWithCategories = await db.collection('books')
    .find({ categories: { $exists: true, $ne: [] } })
    .toArray();

  let categoriesFixed = 0;
  for (const book of booksWithCategories) {
    const oldCategories = book.categories || [];
    const newCategories = oldCategories.map(cat => {
      // Check if this category needs mapping
      if (CATEGORY_MAPPING[cat]) {
        return CATEGORY_MAPPING[cat];
      }
      return cat;
    });

    // Deduplicate
    const uniqueCategories = [...new Set(newCategories)];

    // Only update if changed
    if (JSON.stringify(oldCategories.sort()) !== JSON.stringify(uniqueCategories.sort())) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { categories: uniqueCategories, updated_at: new Date() } }
      );
      categoriesFixed++;
    }
  }
  console.log(`   Normalized categories for ${categoriesFixed} books\n`);

  // Print category distribution after fix
  console.log('4. Category distribution after fix:');
  const categoryCounts = await db.collection('books').aggregate([
    { $unwind: '$categories' },
    { $group: { _id: '$categories', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 }
  ]).toArray();

  for (const cat of categoryCounts) {
    console.log(`   ${cat._id}: ${cat.count}`);
  }

  console.log('\n=== Complete ===');
  await client.close();
}

fixDataQuality().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
