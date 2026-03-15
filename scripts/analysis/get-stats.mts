import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 180000,
  maxPoolSize: 2,
  retryWrites: true,
  retryReads: true,
  connectTimeoutMS: 30000,
});

async function main() {
  try {
    console.log('Connecting...');
    await client.connect();
    console.log('Connected!');

    const db = client.db(process.env.MONGODB_DB);
    const books = db.collection('books');
    const pages = db.collection('pages');

    console.log('Getting stats...');

    const totalBooks = await books.countDocuments();
    const booksWithTranslations = await books.countDocuments({ pages_translated: { $gt: 0 } });
    const totalPages = await pages.countDocuments();
    const pagesWithOcr = await pages.countDocuments({ 'ocr.data': { $exists: true, $ne: null } });
    const pagesTranslated = await pages.countDocuments({ 'translation.data': { $exists: true, $ne: null } });

    const langAgg = await pages.aggregate([
      { $match: { 'translation.language': { $exists: true, $ne: null } } },
      { $group: { _id: '$translation.language' } },
      { $sort: { _id: 1 } }
    ], { maxTimeMS: 60000 }).toArray();
    const distinctLanguages = langAgg.map((doc: any) => doc._id);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentBooks = await books.countDocuments({ created_at: { $gte: thirtyDaysAgo } });

    const ocrPct = totalPages > 0 ? ((pagesWithOcr / totalPages) * 100).toFixed(1) : 0;
    const transPct = totalPages > 0 ? ((pagesTranslated / totalPages) * 100).toFixed(1) : 0;

    console.log('SOURCE LIBRARY STATS');
    console.log('====================');
    console.log(`Total books: ${totalBooks}`);
    console.log(`Books with translations: ${booksWithTranslations}`);
    console.log(`Total pages: ${totalPages}`);
    console.log(`Pages with OCR: ${pagesWithOcr} (${ocrPct}%)`);
    console.log(`Pages translated: ${pagesTranslated} (${transPct}%)`);
    console.log(`Distinct languages: ${distinctLanguages.length}`);
    console.log(`  Languages: ${distinctLanguages.join(', ')}`);
    console.log(`Books added (last 30 days): ${recentBooks}`);

  } catch (err) {
    console.error('ERROR:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
