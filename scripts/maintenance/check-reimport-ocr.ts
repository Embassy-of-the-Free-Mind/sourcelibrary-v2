/**
 * Check which books needing reimport have OCR/translation work
 */

import { MongoClient } from 'mongodb';
import { config } from 'dotenv';
config({ path: '.env.local' });

const bookIds = [
  '69528a33ab34727b1f04ea51', '6952e4b477f38f6761bc7d4c', '6952f71777f38f6761bc997a',
  '6952b06677f38f6761bc2725', '4a8d8a33-7bfe-47de-af1a-6febc5287f98', '6952e4e277f38f6761bc9298',
  '69528f29b184004c526a0eb5', '6953113877f38f6761bcc0d9', '69528662ab34727b1f04c6f8',
  '96f54e7a-a3c2-4623-a8dd-563f61b4b6a0', '69488ddc73ee5c998cfe0f66', '694b3abfde93d1d4cec196fd',
  '8a9eea4b-6be1-4424-9a38-b7a0deb58f95', '69528a25ab34727b1f04e9ec', '6952ca2a77f38f6761bc33bf',
  '6952b03577f38f6761bc211a', '912cf0da-035c-425b-8975-e5a195a47767', '6952e45477f38f6761bc79e0',
  '6952db5477f38f6761bc7402', 'f176cb65-a60e-4f8a-9514-39796f092cde', '6952587bab34727b1f045546',
  '6952dc0077f38f6761bc7792', '694b3b5b58a47807cc735dce', 'adad5f6d-4f68-4009-9406-d0e083cf0acc',
  '69528702ab34727b1f04cf65', '69528622ab34727b1f04c566', 'dcb9a95b-40b3-4a72-ad3b-744f0f766699',
  '69527313ab34727b1f048b15', '5ddd6b40-5a26-4994-86ea-e2dfd4957597', '694f397023a1d0c2ad1d8814',
  '6949af986ef4a68b726b7fa9', '6952c9c477f38f6761bc2eab', '6952db5777f38f6761bc7519',
  '694f397b53410e29f94e13ea', '0a481175-492d-46c5-95b9-8042e7b6710a', '17c0e140-78f4-420f-98b3-01bf7dbb683a',
  '695234ddab34727b1f044cd2', '695289acab34727b1f04db44', '6952861eab34727b1f04c3df',
  '69528b14ab34727b1f04f20a', '6952e45177f38f6761bc7806', '31f2d90a-88af-4414-a445-68406caca58d',
  '6952d08677f38f6761bc5477', '6952d19977f38f6761bc5eb1', '695289a9ab34727b1f04dab6',
  '6952d13377f38f6761bc5e29', '9f2fd808-7d15-40c2-a333-885c67ff3cb5', '695286feab34727b1f04cf28',
  '69528f2bb184004c526a0f1a', '69528549ab34727b1f04b240', 'b453af34-40c2-46ff-876b-9d0245b70087',
  '69526348ab34727b1f046c0b', 'c87fadfa-1543-44b9-a138-573c144246e6', '7fad466b-fc3a-4869-8b8d-8b121fd2def6',
  '695262d8ab34727b1f046ade', '69527326ab34727b1f048b7a', '69528570ab34727b1f04b8a1',
  '694a8046458d70b8c6439c5f', '69525f56ab34727b1f046185', '6952d0c777f38f6761bc59f6',
  '4adda30b-b8da-4e16-ad21-9f14bf286a23', '985e5c8f-b1a4-400e-8761-08ce0fc5b6da', '4f4ff6f9-f0bd-4307-910c-65da7c36c0ef',
  '695289bdab34727b1f04dc4d', '69528566ab34727b1f04b7ee', '6952b05277f38f6761bc265c',
  '69528509ab34727b1f04b1db', '6da19aeb-aec0-411c-b890-73035c92273d', '6952dbf977f38f6761bc7720',
  '69528666ab34727b1f04c966', '6952dbc477f38f6761bc75f1', '69525855ab34727b1f045072',
  '695294dbb184004c526a272b', '6953113477f38f6761bcc018', 'dfb9c1de-d300-4e1b-a9c1-941cdb809764',
  '69525858ab34727b1f0450cf', '694d27e77219319474c057f4', '40124cb0-8498-477f-be31-bc2cd8ab4375',
  '6953117a77f38f6761bcc741', '6953114f77f38f6761bcc478', '9cafe1ee-dd5a-4dcf-ac9a-803ca75f5bb4',
  '6952d04f77f38f6761bc4ee2', '6952b05577f38f6761bc26c0', '71f68423-2c87-47d3-87fa-a744688d3370',
  '7d66e9ad-9572-49c6-82ce-0265337e491d'
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  const books = await db.collection('books').find({ id: { $in: bookIds } }).toArray();

  interface BookInfo {
    id: string;
    title: string;
    ocr: number;
    translated: number;
  }

  const withWork: BookInfo[] = [];
  const noWork: string[] = [];

  for (const book of books) {
    const hasWork = (book.pages_ocr || 0) > 0 || (book.pages_translated || 0) > 0;
    if (hasWork) {
      withWork.push({
        id: book.id,
        title: book.title?.substring(0, 50) || 'Unknown',
        ocr: book.pages_ocr || 0,
        translated: book.pages_translated || 0
      });
    } else {
      noWork.push(book.id);
    }
  }

  console.log('=== BOOKS WITH OCR/TRANSLATION (will lose work) ===');
  for (const b of withWork) {
    console.log(`  ${b.title}: OCR=${b.ocr}, Translated=${b.translated}`);
  }
  console.log(`\nTotal with work: ${withWork.length}`);
  console.log(`Total without work: ${noWork.length}`);
  console.log('\n=== BOOKS WITHOUT WORK (safe to reimport) ===');
  console.log(noWork.join('\n'));

  await client.close();
}

main().catch(console.error);
