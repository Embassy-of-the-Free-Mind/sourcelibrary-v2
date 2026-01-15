import { MongoClient } from 'mongodb';
import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  // Search for Bibles, Torahs, Qurans, and related terms
  const religiousTerms = [
    'bible', 'biblia', 'biblical', 'testament', 'testamentum',
    'torah', 'pentateuch', 'mosaic',
    'quran', 'koran', 'qur',
    'psalms', 'psalm', 'psalter', 'psalterium',
    'gospel', 'evangeli', 'revelation', 'apocalypse', 'apocalypsis',
    'genesis', 'exodus', 'leviticus', 'deuteronomy', 'numbers',
    'scripture', 'holy writ', 'sacra', 'sancta'
  ];

  const regex = religiousTerms.join('|');

  const books = await db.collection('books').find({
    $or: [
      { title: { $regex: regex, $options: 'i' } },
    ]
  }).project({
    id: 1,
    title: 1,
    author: 1,
    year: 1,
    original_language: 1,
    translation_status: 1,
    translated_pages: 1,
    page_count: 1
  }).sort({ year: 1 }).toArray();

  console.log('Found', books.length, 'religious texts:\n');

  // Group by category
  const bibles: any[] = [];
  const psalms: any[] = [];
  const gospels: any[] = [];
  const apocalypse: any[] = [];
  const other: any[] = [];

  for (const b of books) {
    const title = (b.title || '').toLowerCase();
    if (title.includes('biblia') || title.includes('bible') || title.includes('testament')) {
      bibles.push(b);
    } else if (title.includes('psalm') || title.includes('psalter')) {
      psalms.push(b);
    } else if (title.includes('gospel') || title.includes('evangeli')) {
      gospels.push(b);
    } else if (title.includes('apocalyp') || title.includes('revelation')) {
      apocalypse.push(b);
    } else {
      other.push(b);
    }
  }

  function printCategory(name: string, items: any[]) {
    if (items.length === 0) return;
    console.log(`\n=== ${name} (${items.length}) ===\n`);
    for (const b of items) {
      const status = b.translation_status || 'not started';
      const progress = b.translated_pages && b.page_count ?
        Math.round((b.translated_pages / b.page_count) * 100) + '%' : '?';
      console.log(`• ${b.title}`);
      console.log(`  Author: ${b.author || 'Unknown'} | Year: ${b.year || '?'} | Lang: ${b.original_language || '?'}`);
      console.log(`  Translation: ${status} (${progress}) | ID: ${b.id}`);
      console.log('');
    }
  }

  printCategory('BIBLES & TESTAMENTS', bibles);
  printCategory('PSALMS & PSALTERS', psalms);
  printCategory('GOSPELS', gospels);
  printCategory('APOCALYPSE / REVELATION', apocalypse);
  printCategory('OTHER RELIGIOUS TEXTS', other);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Bibles/Testaments: ${bibles.length}`);
  console.log(`Psalms/Psalters: ${psalms.length}`);
  console.log(`Gospels: ${gospels.length}`);
  console.log(`Apocalypse: ${apocalypse.length}`);
  console.log(`Other: ${other.length}`);
  console.log(`Total: ${books.length}`);

  // Count translated
  const translated = books.filter(b => b.translation_status === 'completed' ||
    (b.translated_pages && b.page_count && b.translated_pages >= b.page_count));
  console.log(`\nFully translated: ${translated.length}`);

  await client.close();
}

main();
