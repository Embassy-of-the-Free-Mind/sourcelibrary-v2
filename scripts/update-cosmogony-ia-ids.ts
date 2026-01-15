/**
 * Update Cosmogony Books with Working IA Identifiers
 *
 * The original IA identifiers return 403 from Vercel servers.
 * This script updates to alternative identifiers that work.
 *
 * Run: node --import jiti/register scripts/update-cosmogony-ia-ids.ts
 */

import { MongoClient, ObjectId } from 'mongodb';
import { config } from 'dotenv';

config({ path: '.env.local' });

const MONGODB_URI = process.env.MONGODB_URI!;
const MONGODB_DB = process.env.MONGODB_DB || 'bookstore';

// Mapping of book IDs to working IA identifiers
const UPDATES = [
  {
    bookId: '6964bfcbd00c6d84781505ff',
    title: 'Philo De Opificio',
    oldIdentifier: 'philonisalexandr0000phil',
    newIdentifier: 'philonisalexand00philgoog',
    // Same edition, different digitization (Google vs IA)
  },
  {
    bookId: '6964bfdcb60c0197a3ae873e',
    title: '2 Enoch',
    oldIdentifier: 'booksecretsenoc00morfgoog',
    newIdentifier: 'bookofsecretsofe00morf',
    // Same Morfill/Charles edition
  },
  {
    bookId: '6964bfddb60c0197a3ae87db',
    title: 'Hesiod Theogony',
    oldIdentifier: 'hesiodtheogony0000mlwe',
    newIdentifier: 'hesiod-theogony_202405',
    // Same West edition
  },
  {
    bookId: '6964bfdeb60c0197a3ae89a7',
    title: 'Enuma Elish',
    oldIdentifier: 'enumaelishvol1se0000leon',
    newIdentifier: 'seventabletsofcr02kinguoft',
    // Same King edition, Vol 2 (has translation)
  },
  {
    bookId: '6964bfdeb60c0197a3ae8aa6',
    title: 'Babylonian Creation Myths',
    oldIdentifier: 'babyloniancreati0000unse',
    newIdentifier: 'babylonian-creation-myths',
    // Same Lambert edition
  }
];

async function updateBook(client: MongoClient, update: typeof UPDATES[0]) {
  const db = client.db(MONGODB_DB);
  const booksCollection = db.collection('books');
  const pagesCollection = db.collection('pages');

  console.log(`\nUpdating: ${update.title}`);
  console.log(`  Old ID: ${update.oldIdentifier}`);
  console.log(`  New ID: ${update.newIdentifier}`);

  // Update book document - try both ObjectId and string id
  let bookResult = await booksCollection.updateOne(
    { _id: new ObjectId(update.bookId) },
    {
      $set: {
        ia_identifier: update.newIdentifier,
        source_url: `https://archive.org/details/${update.newIdentifier}`,
        updated_at: new Date()
      }
    }
  );

  if (bookResult.matchedCount === 0) {
    // Try with string id field
    bookResult = await booksCollection.updateOne(
      { id: update.bookId },
      {
        $set: {
          ia_identifier: update.newIdentifier,
          source_url: `https://archive.org/details/${update.newIdentifier}`,
          updated_at: new Date()
        }
      }
    );
  }
  console.log(`  Book update: matched=${bookResult.matchedCount}, modified=${bookResult.modifiedCount}`);

  // Update all page image URLs
  const pagesResult = await pagesCollection.updateMany(
    { book_id: update.bookId },
    [
      {
        $set: {
          image_url: {
            $replaceOne: {
              input: '$image_url',
              find: update.oldIdentifier,
              replacement: update.newIdentifier
            }
          }
        }
      }
    ]
  );

  console.log(`  Pages updated: ${pagesResult.modifiedCount}`);

  return { bookId: update.bookId, pagesUpdated: pagesResult.modifiedCount };
}

async function main() {
  console.log('='.repeat(60));
  console.log('UPDATE COSMOGONY IA IDENTIFIERS');
  console.log('Switching to accessible Archive.org copies');
  console.log('='.repeat(60));

  if (!MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    for (const update of UPDATES) {
      await updateBook(client, update);
    }

    console.log('\n' + '='.repeat(60));
    console.log('DONE - Now run OCR with batch-translate skill');
    console.log('='.repeat(60));

  } finally {
    await client.close();
  }
}

main().catch(console.error);
