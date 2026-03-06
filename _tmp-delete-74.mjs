import { MongoClient } from 'mongodb';

async function checkUrl(url) {
  try {
    const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000), redirect: 'follow' });
    return resp.status < 400;
  } catch {
    return false;
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find broken IA/Harvard thumbnail books with no local page images
  const books = await db.collection('books').find({
    $or: [
      { thumbnail: { $regex: /archive\.org\/download/ } },
      { thumbnail: { $regex: /ids\.lib\.harvard\.edu/ } },
    ],
    pages_count: { $gt: 0 },
  }).toArray();

  // Check which are broken
  const brokenBooks = [];
  const BATCH = 30;
  for (let i = 0; i < books.length; i += BATCH) {
    const batch = books.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(b => checkUrl(b.thumbnail)));
    for (let j = 0; j < batch.length; j++) {
      if (!results[j]) brokenBooks.push(batch[j]);
    }
  }

  // Filter to only those without local page images
  const toDelete = [];
  for (const book of brokenBooks) {
    const hasLocal = await db.collection('pages').findOne(
      { book_id: book.id, $or: [
        { thumbnail_blob: { $exists: true, $ne: null, $ne: '' } },
        { cropped_photo: { $exists: true, $ne: null, $ne: '' } },
        { archived_photo: { $exists: true, $ne: null, $ne: '' } },
      ]},
      { projection: { _id: 1 } }
    );
    if (!hasLocal) toDelete.push(book);
  }

  console.log(`Soft-deleting ${toDelete.length} books...\n`);

  let deleted = 0;
  for (const book of toDelete) {
    // Move to deleted_books (soft delete)
    const { _id, ...bookData } = book;
    await db.collection('deleted_books').insertOne({
      ...bookData,
      _original_id: _id,
      deleted_at: new Date(),
      deleted_reason: 'IA access restricted — all images blocked (403/404), 0 OCR, 0 translations',
    });

    // Delete pages
    const pageResult = await db.collection('pages').deleteMany({ book_id: book.id });

    // Delete the book
    await db.collection('books').deleteOne({ _id });

    deleted++;
    const iaId = book.thumbnail?.match(/download\/([^/]+)/)?.[1] || '?';
    console.log(`  Deleted: ${book.title?.substring(0, 60)} (${pageResult.deletedCount} pages) [${iaId}]`);
  }

  console.log(`\nDone. Deleted ${deleted} books.`);

  // Output list for GitHub issue
  console.log('\n=== FOR GITHUB ISSUE ===');
  for (const book of toDelete) {
    const iaId = book.thumbnail?.match(/download\/([^/]+)/)?.[1] || book.image_source?.identifier || '?';
    const lang = book.original_language || book.language || '?';
    const collections = book.collections?.join(', ') || 'none';
    console.log(`- [ ] **${book.title}** — ${book.author || '?'} (${book.published || '?'}) [${lang}] | IA: \`${iaId}\` | Collections: ${collections}`);
  }

  await client.close();
}

main();
