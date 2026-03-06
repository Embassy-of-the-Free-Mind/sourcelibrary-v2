// Phase 3b: Import remaining books found by background search agent + additional searches

async function importBook(data) {
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

const BOOKS = [
  // Motse / Mozi — DLI scan, 1929 original
  {
    ia_identifier: 'in.ernet.dli.2015.283868',
    title: 'The Ethical and Political Works of Motse',
    author: 'Y.P. Mei',
    original_language: 'Chinese',
    collections: ['philosophy'],
  },
  // Bastiat — French original, 1851 2nd edition
  {
    ia_identifier: 'harmonieseconomi00bastuoft',
    title: 'Harmonies économiques',
    author: 'Frédéric Bastiat',
    original_language: 'French',
    collections: ['philosophy'],
  },
  // Fabre d'Olivet — Italian translation (only accessible edition)
  {
    ia_identifier: 'fabre-d-olivet-antoine-la-musica-spiegata',
    title: 'La musica spiegata come scienza e come arte',
    author: "Antoine Fabre d'Olivet",
    original_language: 'Italian',
    collections: ['music'],
  },
  // 1001 Nights Vol. 6 — accessible UofT scan
  {
    ia_identifier: 'plainliteraltran06burtuoft',
    title: 'The Book of the Thousand Nights and a Night, Vol. 6',
    author: 'Richard F. Burton',
    original_language: 'English',
    collections: ['literature'],
  },
  // Ancient Buddhism in Japan Vol. 2 — DLI/IGNCA scan
  {
    ia_identifier: 'in.gov.ignca.35672',
    title: 'Ancient Buddhism in Japan, Vol. 2',
    author: 'M.W. de Visser',
    original_language: 'English',
    collections: ['theology'],
  },
  // Herodoti Historiae — 1908 accessible edition
  {
    ia_identifier: 'herodotihistoria01hero',
    title: 'Herodoti Historiae',
    author: 'Herodotus',
    original_language: 'Greek',
    collections: ['philosophy'],
  },
];

async function main() {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  for (const book of BOOKS) {
    const { collections, ...importData } = book;
    process.stdout.write(`Importing: ${book.title}... `);

    const result = await importBook(importData);
    if (result.success) {
      console.log(`OK — ${result.pages || '?'} pages (${result.bookId})`);
      if (collections?.length) {
        await db.collection('books').updateOne(
          { id: result.bookId },
          { $set: { collections } }
        );
      }
      // Enroll in pipeline
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
