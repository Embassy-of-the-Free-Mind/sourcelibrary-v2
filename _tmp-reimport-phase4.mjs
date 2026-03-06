// Phase 4: Import remaining primary sources from alternative digital libraries

async function importIA(data) {
  const resp = await fetch('https://sourcelibrary.org/api/import/ia', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(120000),
  });
  const result = await resp.json();
  if (resp.ok) {
    return { success: true, bookId: result.id || result.bookId, pages: result.pages_count || result.pagesCount };
  }
  return { success: false, error: result.error || `HTTP ${resp.status}` };
}

async function importERara(data) {
  const resp = await fetch('https://sourcelibrary.org/api/import/e-rara', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(120000),
  });
  const result = await resp.json();
  if (resp.ok) {
    return { success: true, bookId: result.id || result.bookId, pages: result.pages_count || result.pagesCount };
  }
  return { success: false, error: result.error || `HTTP ${resp.status}` };
}

const IA_BOOKS = [
  {
    ia_identifier: 'cu31924104094085',
    title: 'Zuni Fetiches',
    author: 'Frank Hamilton Cushing',
    original_language: 'English',
    collections: ['theology'],
  },
  {
    ia_identifier: 'statutesapostle00unkngoog',
    title: 'The Statutes of the Apostles (Apostolic Tradition)',
    author: 'Hippolytus of Rome (ed. George Horner)',
    original_language: 'Greek',
    collections: ['theology'],
  },
  {
    ia_identifier: 'deplatonicaeatq00pletgoog',
    title: 'De Platonicae atque Aristotelicae Philosophiae Differentia',
    author: 'George Gemistos Plethon',
    original_language: 'Greek',
    collections: ['philosophy'],
  },
  {
    ia_identifier: 'sacredbooksearly13hornuoft',
    title: 'Sacred Books and Early Literature of the East, Vol. 13: Japan',
    author: 'Charles Francis Horne (ed.)',
    original_language: 'Japanese',
    collections: ['theology'],
  },
];

const ERARA_BOOKS = [
  {
    erara_id: '18789590',
    title: 'Harmonia Macrocosmica',
    author: 'Andreas Cellarius',
    language: 'Latin',
    published: '1708',
    collections: ['philosophy'],
  },
];

async function main() {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Import IA books
  for (const book of IA_BOOKS) {
    const { collections, ...importData } = book;
    process.stdout.write(`Importing (IA): ${book.title}... `);

    const result = await importIA(importData);
    if (result.success) {
      console.log(`OK — ${result.pages || '?'} pages (${result.bookId})`);
      if (collections?.length) {
        await db.collection('books').updateOne(
          { id: result.bookId },
          { $set: { collections } }
        );
      }
      await db.collection('books').updateOne(
        { id: result.bookId },
        { $set: {
          pipeline_auto: {
            status: 'queued',
            source: 'admin',
            queued_at: new Date(),
            last_updated: new Date(),
          }
        }}
      );
    } else {
      console.log(`FAILED: ${result.error}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // Import e-rara books
  for (const book of ERARA_BOOKS) {
    const { collections, ...importData } = book;
    process.stdout.write(`Importing (e-rara): ${book.title}... `);

    const result = await importERara(importData);
    if (result.success) {
      console.log(`OK — ${result.pages || '?'} pages (${result.bookId})`);
      if (collections?.length) {
        await db.collection('books').updateOne(
          { id: result.bookId },
          { $set: { collections } }
        );
      }
      await db.collection('books').updateOne(
        { id: result.bookId },
        { $set: {
          pipeline_auto: {
            status: 'queued',
            source: 'admin',
            queued_at: new Date(),
            last_updated: new Date(),
          }
        }}
      );
    } else {
      console.log(`FAILED: ${result.error}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  await client.close();
}

main();
