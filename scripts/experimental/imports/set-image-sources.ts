/**
 * Script to auto-detect and set image_source based on thumbnail URLs
 *
 * Run with: npx tsx scripts/set-image-sources.ts
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI environment variable is required');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(MONGODB_URI!);

  try {
    await client.connect();
    const db = client.db();
    const books = db.collection('books');

    // Find all books without image_source
    const booksWithoutSource = await books.find({
      image_source: { $exists: false }
    }).toArray();

    console.log(`Found ${booksWithoutSource.length} books without image_source\n`);

    const updates: { id: string; source: string; provider: string }[] = [];
    const unknown: { id: string; title: string; thumbnail: string | null }[] = [];

    for (const book of booksWithoutSource) {
      const thumbnail = book.thumbnail || '';
      const firstPagePhoto = book.pages?.[0]?.photo || '';
      const checkUrl = thumbnail || firstPagePhoto;

      let provider: string | null = null;
      let providerName: string | null = null;
      let sourceUrl: string | null = null;
      let identifier: string | null = null;

      // Detect source from URL patterns
      if (checkUrl.includes('archive.org')) {
        provider = 'internet_archive';
        providerName = 'Internet Archive';
        // Extract identifier from URL like archive.org/download/IDENTIFIER/...
        const match = checkUrl.match(/archive\.org\/download\/([^/]+)/);
        if (match) {
          identifier = match[1];
          sourceUrl = `https://archive.org/details/${identifier}`;
        }
      } else if (checkUrl.includes('books.google')) {
        provider = 'google_books';
        providerName = 'Google Books';
        // Extract ID from URL
        const match = checkUrl.match(/id=([^&]+)/);
        if (match) {
          identifier = match[1];
          sourceUrl = `https://books.google.com/books?id=${identifier}`;
        }
      } else if (checkUrl.includes('s3.amazonaws.com') || checkUrl.includes('.s3.')) {
        // S3 URLs are likely EFM scans
        provider = 'efm';
        providerName = 'Embassy of the Free Mind';
      } else if (checkUrl.startsWith('/Users/') || checkUrl.startsWith('/home/')) {
        // Local file paths - likely EFM scans imported locally
        provider = 'efm';
        providerName = 'Embassy of the Free Mind';
      }

      if (provider) {
        updates.push({
          id: book.id,
          source: checkUrl.substring(0, 50),
          provider,
        });

        await books.updateOne(
          { id: book.id },
          {
            $set: {
              image_source: {
                provider,
                provider_name: providerName,
                source_url: sourceUrl,
                identifier: identifier || book.ia_identifier,
                license: 'publicdomain',
                access_date: new Date(),
              },
              updated_at: new Date(),
            },
          }
        );
      } else {
        unknown.push({
          id: book.id,
          title: book.title,
          thumbnail: book.thumbnail,
        });
      }
    }

    console.log('Updates by provider:');
    const byProvider = updates.reduce((acc, u) => {
      acc[u.provider] = (acc[u.provider] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    for (const [provider, count] of Object.entries(byProvider)) {
      console.log(`  ${provider}: ${count}`);
    }

    console.log(`\nUpdated ${updates.length} books`);

    if (unknown.length > 0) {
      console.log(`\n${unknown.length} books could not be auto-detected:`);
      for (const book of unknown.slice(0, 10)) {
        console.log(`  - ${book.title} (${book.id})`);
        console.log(`    thumbnail: ${book.thumbnail || 'none'}`);
      }
    }

  } finally {
    await client.close();
  }
}

main().catch(console.error);
