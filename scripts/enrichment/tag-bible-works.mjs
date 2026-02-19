#!/usr/bin/env node
/**
 * Tag Bible-related books with work_id for WEMI-style grouping.
 *
 * Work IDs:
 *   bible-complete    — Complete Bibles (OT+NT together)
 *   bible-ot          — Old Testament / Hebrew Bible editions
 *   bible-nt          — New Testament editions
 *   bible-apocrypha   — Apocryphal and pseudepigraphical collections
 *   bible-psalms      — Psalms collections
 *   bible-apocalypse  — Revelation / Apocalypse texts
 *
 * Usage: secret-lover run -- node scripts/tag-bible-works.mjs [--dry-run]
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Use: secret-lover run -- node scripts/tag-bible-works.mjs');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

// Work assignments: book id → work_id
// These are the custom `id` fields from the books collection
const workAssignments = {
  // === COMPLETE BIBLES ===
  // Full OT+NT in one tradition
  'bible-complete': [
    '6952e4c677f38f6761bc882d',   // Biblia Sacra Vulgatae Editionis (Latin Vulgate, 1804)
    '699209a0bed8f4b5ff5b112b',   // Biblia Sacra (Gutenberg Bible) — 192 pages
    '6992009a768b426600239d59',   // The Gutenberg Bible — 100 pages
    '695aaf48ccf1d7d64e9e0966',   // Codex Gigas (Devil's Bible)
    '6953cc7077f38f6761be22bc',   // Illuminated Medieval Bible
    '699209ee3314ba2d80f86964',   // Biblia: Luther Bible (1535)
    '6992468abc722ec0ee80e04f',   // The Geneva Bible (1560)
    '699209ffa0b3f4095802ef6b',   // Holy Bible: Authorized Version 1611 (KJV)
    '6952e50877f38f6761bc95bb',   // The Hexaglot Bible (1901)
    '699209c4bed8f4b5ff5b2c6b',   // Biblia Polyglotta Complutensis
    '6992469abc722ec0ee80efa9',   // Eliot Indian Bible
    '69920bcde0a548a13d885a90',   // Al-Kitab al-Muqaddas: Arabic Bible
    '699246b3bc722ec0ee81114f',   // The Holy Bible (Wycliffe) Vol 1
  ],

  // === OLD TESTAMENT ===
  'bible-ot': [
    '6952e4bc77f38f6761bc7db1',   // Biblia Hebraica (Michaelis, 1720)
    '69924401bc722ec0ee80b312',   // Mikraot Gedolot (First Rabbinic Bible, 1517)
    '6952e4b477f38f6761bc7d4c',   // Septuaginta (Greek OT, 1855)
    '6953a8a477f38f6761bd2334',   // Greek OT (Tischendorf, 1877)
    '69920b90e0a548a13d883e43',   // OT in Syriac (Peshitta)
    '69920b8ae0a548a13d88384b',   // Biblia Veteris Testamenti Aethiopica
    '69920b6ee0a548a13d8827e9',   // Armenian Bible, OT (Zohrab)
    '69920bc6e0a548a13d885667',   // Codex Sinaiticus: OT (Facsimile)
  ],

  // === NEW TESTAMENT ===
  'bible-nt': [
    '6952e4cc77f38f6761bc8c0b',   // Novum Testamentum Graece (Tischendorf, 1869)
    '6952e50377f38f6761bc933f',   // Erasmus Opera Omnia - Novum Testamentum (1705)
    '69920b97e0a548a13d8840d5',   // NT in Syriac (Peshitta)
    '69920b7de0a548a13d883364',   // Coptic NT, Bohairic (Horner)
    '69920b83e0a548a13d8835ea',   // Coptic NT, Sahidic (Horner)
    '69920b74e0a548a13d882d08',   // Armenian Bible, NT (Zohrab)
    '69920bbfe0a548a13d885514',   // Codex Sinaiticus: NT (Facsimile)
    '699246a1bc722ec0ee80f7e6',   // Codex Vaticanus: NT Graece
    '6953a82c77f38f6761bd0bc5',   // NT Armenian-Greek-Italian trilingual
    '699209f7a0b3f4095802ee49',   // The Newe Testament (Tyndale, 1526)
    '69924691bc722ec0ee80e81a',   // The Nevv Testament (Douay-Rheims, 1582)
  ],

  // === APOCRYPHA & PSEUDEPIGRAPHA ===
  'bible-apocrypha': [
    '69924661bc722ec0ee80b743',   // Apocrypha & Pseudepigrapha OT, Vol. 1 (Charles)
    '69924669bc722ec0ee80bafa',   // Apocrypha & Pseudepigrapha OT, Vol. 2 (Charles)
    '69924671bc722ec0ee80c069',   // The Apocryphal NT (M. R. James)
    '69924688bc722ec0ee80deaf',   // The Apocryphal OT (Sparks)
    '69924690bc722ec0ee80e555',   // NT Apocrypha, Vol. 1: Gospels (Schneemelcher)
    '69924698bc722ec0ee80eb4a',   // NT Apocrypha, Vol. 2: Apostles (Schneemelcher)
    '69924680bc722ec0ee80d291',   // OT Pseudepigrapha, Vol. 2 (Charlesworth)
    '699246afbc722ec0ee810fea',   // Apocalypses Apocryphae (Tischendorf)
    '6992470ad263adc1aa7b0180',   // The Apocalypse of Abraham
    '6953a42677f38f6761bce90c',   // Uncanonical Writings of OT (Armenian)
  ],

  // === PSALMS ===
  'bible-psalms': [
    '699246f3cc5d59af1430ffd1',   // Psalms of Solomon (Greek Critical Text)
    '6953115277f38f6761bcc51b',   // The Odes and Psalms of Solomon (Syriac)
  ],
};

async function main() {
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  let totalUpdated = 0;

  for (const [workId, bookIds] of Object.entries(workAssignments)) {
    console.log(`\n--- ${workId} (${bookIds.length} books) ---`);

    for (const bookId of bookIds) {
      // Try both id field and _id
      const query = bookId.length === 24
        ? { $or: [{ id: bookId }, { _id: new (await import('mongodb')).ObjectId(bookId) }] }
        : { id: bookId };

      const book = await books.findOne(query, { projection: { id: 1, title: 1, display_title: 1, work_id: 1 } });

      if (!book) {
        console.log(`  [SKIP] ${bookId} — not found`);
        continue;
      }

      const title = book.display_title || book.title;
      const existingWorkId = book.work_id;

      if (existingWorkId === workId) {
        console.log(`  [OK]   ${title} — already tagged`);
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY]  ${title} → ${workId}${existingWorkId ? ` (was: ${existingWorkId})` : ''}`);
      } else {
        await books.updateOne(
          { _id: book._id },
          { $set: { work_id: workId } }
        );
        console.log(`  [SET]  ${title} → ${workId}`);
      }
      totalUpdated++;
    }
  }

  console.log(`\n${dryRun ? 'Would update' : 'Updated'} ${totalUpdated} books.`);

  // Create index on work_id for efficient queries
  if (!dryRun) {
    await books.createIndex({ work_id: 1 }, { sparse: true });
    console.log('Created sparse index on work_id.');
  }

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
